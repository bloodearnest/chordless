/**
 * Opening the database says how it went (docs/MIGRATIONS.md, docs/OBSERVABILITY.md): one span when
 * it was upgraded, blocked or failed, none for the many plain opens, and the version it is at on
 * every span. A database newer than the code is told to the person, and so is one that another
 * window upgraded.
 */
import { expect, waitUntil } from '@open-wc/testing'
import { trace } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import {
  ChordlessDB,
  DatabaseNewerError,
  DatabaseTooOldError,
  DB_VERSION,
  OLDEST_UPGRADABLE,
} from '../src/js/db.ts'
import { setTelemetryPreference } from '../src/js/preferences.ts'
import { baselineAttributes } from '../src/js/telemetry/baseline.ts'
import { setAmbient } from '../src/js/telemetry/context.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { oldDatabase, SCHEMA_V14 } from './old-database.ts'
import { clearToasts, deleteDatabase, shownToast } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

const exporter = new InMemorySpanExporter()
const opens = () => exporter.getFinishedSpans().filter(span => span.name === 'chordless.db.open')

beforeEach(() => {
  localStorage.clear()
  setTelemetryPreference(true)
  trace.disable()
  trace.setGlobalTracerProvider(
    new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] })
  )
  exporter.reset()
  setAmbient({ dbVersion: undefined })
})

afterEach(() => {
  trace.disable()
  localStorage.clear()
  clearToasts()
})

describe('ChordlessDB opening, as reported', () => {
  it('reports an upgrade, with the versions and how long it took', async () => {
    const name = await oldDatabase(14, SCHEMA_V14)
    const db = new ChordlessDB(name)
    await db.init()
    db.db?.close()
    await deleteDatabase(name)

    const [span] = opens()
    expect(opens()).to.have.length(1)
    expect(span.attributes).to.include({
      'chordless.db.outcome': 'upgraded',
      'chordless.db.old_version': 14,
      'chordless.db.new_version': DB_VERSION,
    })
    expect(span.attributes['chordless.db.open_ms']).to.be.a('number')
  })

  it('reports nothing for a database made new, or opened again', async () => {
    const name = `test-plain-${crypto.randomUUID()}`
    const first = new ChordlessDB(name)
    await first.init()
    first.db?.close()
    const again = new ChordlessDB(name)
    await again.init()
    again.db?.close()
    await deleteDatabase(name)
    expect(opens()).to.have.length(0)
  })

  it('puts the version it opened at on every span', async () => {
    const name = `test-version-${crypto.randomUUID()}`
    const db = new ChordlessDB(name)
    await db.init()
    db.db?.close()
    await deleteDatabase(name)
    expect(baselineAttributes()['chordless.db.version']).to.equal(DB_VERSION)
  })

  it('says when the data is newer than the code, as an error with the reason, and offers to look for an update', async () => {
    const name = await oldDatabase(DB_VERSION + 1, SCHEMA_V14)
    let error: unknown
    try {
      await new ChordlessDB(name).init()
    } catch (caught) {
      error = caught
    }
    await deleteDatabase(name)

    expect(error).to.be.instanceOf(DatabaseNewerError)
    const [span] = opens()
    expect(span.attributes).to.include({
      'chordless.db.outcome': 'failed',
      'chordless.db.error': 'VersionError',
      'chordless.error': true,
    })
    await waitUntil(() => shownToast() !== null, 'the toast')
    expect(shownToast()).to.include({ kind: 'error' })
    expect(shownToast()?.message).to.contain('newer Chordless data')
    expect(shownToast()?.action?.label).to.equal('Check for updates')
    // (pressed: there is no service worker here to ask, so nothing comes of it)
    shownToast()?.action?.run()
  })

  it('says so when another window upgrades the database, and has let go of it', async () => {
    const name = `test-other-window-${crypto.randomUUID()}`
    const db = new ChordlessDB(name)
    await db.init()
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, DB_VERSION + 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    upgraded.close()
    await waitUntil(() => shownToast() !== null, 'the toast')
    expect(shownToast()?.message).to.contain('updated in another window')
    expect(shownToast()?.action?.label).to.equal('Reload')
    await deleteDatabase(name)
  })

  it('does not say so when the database is deleted', async () => {
    const name = `test-deleted-${crypto.randomUUID()}`
    const db = new ChordlessDB(name)
    await db.init()
    await deleteDatabase(name)
    expect(shownToast()).to.equal(null)
  })
})

describe('ChordlessDB opening a database older than it upgrades', () => {
  let uninstall: () => void
  let worker: ReturnType<typeof installFakeAuthWorker>['worker']

  beforeEach(() => {
    ;({ worker, uninstall } = installFakeAuthWorker())
  })
  afterEach(() => uninstall())

  const signIn = (scope?: string) => {
    worker.stored = {
      blob: 'blob',
      metadata: {
        access_token: 'good',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        ...(scope ? { scope } : {}),
      },
      updated_at: new Date().toISOString(),
    }
  }

  const old = () => oldDatabase(OLDEST_UPGRADABLE - 1, SCHEMA_V14, { songs: [{ uuid: 'song-1' }] })

  /** What an old database holds, read without upgrading it */
  const songsIn = async (name: string) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const version = db.version
    const songs = await new Promise<unknown[]>(resolve => {
      const request = db.transaction('songs').objectStore('songs').getAll()
      request.onsuccess = () => resolve(request.result)
    })
    db.close()
    return { version, songs }
  }

  it('leaves it as it is, and says so, when there is no sign-in to bring it back from Drive', async () => {
    const name = await old()
    let error: unknown
    try {
      await new ChordlessDB(name).init()
    } catch (caught) {
      error = caught
    }
    expect(error).to.be.instanceOf(DatabaseTooOldError)
    expect((error as DatabaseTooOldError).version).to.equal(OLDEST_UPGRADABLE - 1)
    expect(await songsIn(name)).to.deep.equal({
      version: OLDEST_UPGRADABLE - 1,
      songs: [{ uuid: 'song-1' }],
    })
    await deleteDatabase(name)

    expect(opens()[0].attributes).to.include({
      'chordless.db.outcome': 'too_old',
      'chordless.db.old_version': OLDEST_UPGRADABLE - 1,
      'chordless.db.sign_in': 'signed-out',
    })
    await waitUntil(() => shownToast() !== null, 'the toast')
    expect(shownToast()?.kind).to.equal('error')
    expect(shownToast()?.details).to.contain('left as it is')
  })

  it('leaves it as it is when the sign-in has no Drive to bring it back from', async () => {
    signIn('openid email profile')
    const name = await old()
    let error: unknown
    try {
      await new ChordlessDB(name).init()
    } catch (caught) {
      error = caught
    }
    expect(error).to.be.instanceOf(DatabaseTooOldError)
    expect((await songsIn(name)).songs).to.have.length(1)
    await deleteDatabase(name)
    expect(opens()[0].attributes['chordless.db.sign_in']).to.equal('no-drive')
  })

  it('clears it and makes it again, to be brought back from Drive, when signed in with Drive', async () => {
    signIn()
    const name = await old()
    const db = new ChordlessDB(name)
    await db.init()
    expect(db.db?.version).to.equal(DB_VERSION)
    expect(await db.getAllSongs()).to.deep.equal([])
    db.db?.close()
    await deleteDatabase(name)

    expect(opens().map(span => span.attributes['chordless.db.outcome'])).to.deep.equal(['cleared'])
    expect(opens()[0].attributes['chordless.db.old_version']).to.equal(OLDEST_UPGRADABLE - 1)
    await waitUntil(() => shownToast() !== null, 'the toast')
    expect(shownToast()?.kind).to.equal('info')
    expect(shownToast()?.message).to.contain('back from Drive')
  })

  it('upgrades the oldest version it upgrades, whoever is signed in', async () => {
    const name = await oldDatabase(OLDEST_UPGRADABLE, SCHEMA_V14, { songs: [{ uuid: 'song-1' }] })
    const db = new ChordlessDB(name)
    await db.init()
    expect(db.db?.version).to.equal(DB_VERSION)
    db.db?.close()
    await deleteDatabase(name)
    expect(opens()[0].attributes['chordless.db.outcome']).to.equal('upgraded')
  })
})
