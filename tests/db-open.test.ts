/**
 * Opening the database says how it went (docs/MIGRATIONS.md, docs/OBSERVABILITY.md): one span when
 * it was upgraded, blocked or failed, none for the many plain opens, and the version it is at on
 * every span. A database newer than the code is told to the person, and so is one that another
 * window upgraded.
 */
import { expect, waitUntil } from '@open-wc/testing'
import { trace } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import { ChordlessDB, DatabaseNewerError, DB_VERSION } from '../src/js/db.ts'
import { setTelemetryPreference } from '../src/js/preferences.ts'
import { baselineAttributes } from '../src/js/telemetry/baseline.ts'
import { setAmbient } from '../src/js/telemetry/context.ts'
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
