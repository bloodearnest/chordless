import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { syncOverlays } from '../src/js/overlay-sync.ts'
import { makeEntry, makeSetlist, makeSong } from './builders.ts'
import { deleteDatabase } from './test-helpers.ts'

const { describe, it, afterEach } = window

/** What the server keeps: the Worker's rules in a few lines (one document, a version to write from), enough to test the other side of them */
class Server {
  version = 0
  body = {
    settings: {} as Record<string, string>,
    setlists: {} as Record<string, unknown>,
    songs: {} as Record<string, unknown>,
  }
  calls: string[] = []
  /** Writes that another device gets in first: each makes the next write find a newer version */
  interfere = 0
  fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    this.calls.push(`${init?.method ?? 'GET'} ${url.pathname}`)
    if (init?.method === 'PUT') {
      const sent = JSON.parse(String(init.body)) as { baseVersion: number; body: Server['body'] }
      if (this.interfere > 0) {
        this.interfere--
        this.version++
      }
      if (sent.baseVersion !== this.version)
        return Response.json(
          { error: 'The overlays changed', current: { version: this.version, body: this.body } },
          { status: 409 }
        )
      this.version++
      this.body = sent.body
      return Response.json({ version: this.version })
    }
    return Response.json({ version: this.version, body: this.body })
  }) as typeof fetch
  /** Set an item as another device would have */
  set(key: 'setlists' | 'songs', id: string, value: unknown) {
    this.body[key][id] = value
    this.version++
  }
}

class Keys {
  map = new Map<string, string>()
  getItem = (key: string) => this.map.get(key) ?? null
  setItem = (key: string, value: string) => void this.map.set(key, value)
  removeItem = (key: string) => void this.map.delete(key)
}

const handles: ChordlessDB[] = []
afterEach(async () => {
  for (const db of handles.splice(0)) {
    db.db?.close()
    await deleteDatabase(db.dbName)
  }
})

/** A device: its own database and browser storage, on the same server */
async function device(server: Server) {
  const db = new ChordlessDB(`test-overlay-${crypto.randomUUID()}`)
  await db.init()
  handles.push(db)
  const storage = new Keys()
  await db.saveSong(makeSong({ uuid: 'uuid-song', id: 'title-song' }))
  await db.saveSetlist(makeSetlist({ id: 'set', songs: [makeEntry({ songUuid: 'uuid-song' })] }))
  const sync = () =>
    syncOverlays({
      db,
      storage,
      connection: { token: async () => 't', origin: 'https://chordless.test', fetch: server.fetch },
    })
  return { db, storage, sync }
}

describe('syncing what a person keeps for themselves', () => {
  it('sends a setlist’s state, a song’s settings and the person’s own settings, and nothing the device keeps for itself', async () => {
    const server = new Server()
    const one = await device(server)
    one.storage.setItem('state-set', JSON.stringify({ capo: 2, annotations: ['a'] }))
    one.storage.setItem(
      `song-prefs-${one.db.spaceId}`,
      JSON.stringify({ 'title-song': { capo: 3, padSetId: 'SET1' }, 'title-gone': { capo: 1 } })
    )
    one.storage.setItem('musician_type', 'guitarist')
    one.storage.setItem('theme', 'dark')
    expect(await one.sync()).to.deep.equal({ sent: 3, taken: 0 })
    expect(server.body).to.deep.equal({
      settings: { musician_type: 'guitarist' },
      setlists: { set: { state: { capo: 2, annotations: ['a'] } } },
      songs: { 'uuid-song': { capo: 3, padSetId: 'SET1' } },
    })
    expect(server.calls).to.deep.equal(['GET /api/account/overlays', 'PUT /api/account/overlays'])
  })

  it('sends nothing again when nothing changed, and only what did when something has', async () => {
    const server = new Server()
    const one = await device(server)
    one.storage.setItem('state-set', JSON.stringify({ capo: 2 }))
    one.storage.setItem('pitch', 'Bb')
    await one.sync()
    server.calls.length = 0
    expect(await one.sync()).to.deep.equal({ sent: 0, taken: 0 })
    expect(server.calls).to.deep.equal(['GET /api/account/overlays'])
    one.storage.setItem('state-set', JSON.stringify({ capo: 4 }))
    expect(await one.sync()).to.deep.equal({ sent: 1, taken: 0 })
    expect(server.body.setlists).to.deep.equal({ set: { state: { capo: 4 } } })
    expect(server.body.settings).to.deep.equal({ pitch: 'Bb' })
  })

  it('takes what another device changed, onto a device that has the setlist and song', async () => {
    const server = new Server()
    const one = await device(server)
    one.storage.setItem('state-set', JSON.stringify({ capo: 2 }))
    one.storage.setItem('tuning', '-1')
    one.storage.setItem(
      `song-prefs-${one.db.spaceId}`,
      JSON.stringify({ 'title-song': { capo: 5 } })
    )
    await one.sync()
    const two = await device(server)
    expect(await two.sync()).to.deep.equal({ sent: 0, taken: 3 })
    expect(JSON.parse(two.storage.getItem('state-set') ?? '')).to.deep.equal({ capo: 2 })
    expect(two.storage.getItem('tuning')).to.equal('-1')
    expect(JSON.parse(two.storage.getItem(`song-prefs-${two.db.spaceId}`) ?? '')).to.deep.equal({
      'title-song': { capo: 5 },
    })
    // and a later change by the first arrives at the second
    one.storage.setItem('state-set', JSON.stringify({ capo: 7 }))
    await one.sync()
    expect(await two.sync()).to.deep.equal({ sent: 0, taken: 1 })
    expect(JSON.parse(two.storage.getItem('state-set') ?? '')).to.deep.equal({ capo: 7 })
  })

  it('takes the songs a person added for themselves, and puts them back after the shared ones', async () => {
    const server = new Server()
    const one = await device(server)
    const mine = makeEntry({ songUuid: 'uuid-mine', local: true, order: 1 })
    const setlist = must(await one.db.getSetlist('set'))
    await one.db.saveSetlist({ ...setlist, songs: [...setlist.songs, mine] })
    await one.sync()
    expect(((server.body.setlists.set ?? {}) as { local?: unknown[] }).local).to.have.length(1)
    const two = await device(server)
    await two.sync()
    const taken = must(await two.db.getSetlist('set'))
    expect(taken.songs.map(each => [each.songUuid, each.local ?? false])).to.deep.equal([
      ['uuid-song', false],
      ['uuid-mine', true],
    ])
  })

  it('keeps what is here over what changed in both places, and sends it', async () => {
    const server = new Server()
    const one = await device(server)
    const two = await device(server)
    one.storage.setItem('state-set', JSON.stringify({ capo: 1 }))
    await one.sync()
    await two.sync()
    one.storage.setItem('state-set', JSON.stringify({ capo: 2 }))
    await one.sync()
    two.storage.setItem('state-set', JSON.stringify({ capo: 9 }))
    expect(await two.sync()).to.deep.equal({ sent: 1, taken: 0 })
    expect(server.body.setlists).to.deep.equal({ set: { state: { capo: 9 } } })
  })

  it('leaves what another device changed in another item alone when it sends its own', async () => {
    const server = new Server()
    const one = await device(server)
    one.storage.setItem('state-set', JSON.stringify({ capo: 1 }))
    one.storage.setItem('pitch', 'F')
    await one.sync()
    const two = await device(server)
    await two.sync()
    // the first changes a setting, the second a setlist, and each sends: neither undoes the other
    one.storage.setItem('pitch', 'Bb')
    two.storage.setItem('state-set', JSON.stringify({ capo: 6 }))
    await one.sync()
    await two.sync()
    expect(server.body.settings).to.deep.equal({ pitch: 'Bb' })
    expect(server.body.setlists).to.deep.equal({ set: { state: { capo: 6 } } })
    await one.sync()
    expect(JSON.parse(one.storage.getItem('state-set') ?? '')).to.deep.equal({ capo: 6 })
  })

  it('goes again from what is there when another device wrote first, and gives up when it keeps happening', async () => {
    const server = new Server()
    const one = await device(server)
    one.storage.setItem('pitch', 'F')
    server.interfere = 1
    expect(await one.sync()).to.deep.equal({ sent: 1, taken: 0 })
    expect(server.calls.filter(call => call.startsWith('PUT'))).to.have.length(2)
    one.storage.setItem('pitch', 'Bb')
    server.interfere = 5
    let error: unknown
    try {
      await one.sync()
    } catch (caught) {
      error = caught
    }
    expect(String(error)).to.contain('keep changing')
  })

  it('says so when the server refuses a write for another reason', async () => {
    const server = new Server()
    const one = await device(server)
    one.storage.setItem('pitch', 'F')
    const answer = server.fetch
    server.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PUT'
        ? Response.json({ error: 'Not allowed' }, { status: 400 })
        : answer(input, init)) as typeof fetch
    let error: unknown
    try {
      await one.sync()
    } catch (caught) {
      error = caught
    }
    expect(String(error)).to.contain('Not allowed')
  })

  it('sends a removal, and does not clear what is kept when the server stops showing it', async () => {
    const server = new Server()
    const one = await device(server)
    one.storage.setItem('state-set', JSON.stringify({ capo: 2 }))
    await one.sync()
    one.storage.removeItem('state-set')
    expect(await one.sync()).to.deep.equal({ sent: 1, taken: 0 })
    expect(server.body.setlists).to.deep.equal({})
    // (the person left the church: the server shows nothing, and the device keeps its own)
    one.storage.setItem('state-set', JSON.stringify({ capo: 3 }))
    await one.sync()
    server.body.setlists = {}
    server.version++
    expect(await one.sync()).to.deep.equal({ sent: 0, taken: 0 })
    expect(JSON.parse(one.storage.getItem('state-set') ?? '')).to.deep.equal({ capo: 3 })
  })

  it('takes nothing for a setlist or song this device does not have yet', async () => {
    const server = new Server()
    const one = await device(server)
    server.set('setlists', 'other', { state: { capo: 1 } })
    server.set('songs', 'other', { capo: 1 })
    expect(await one.sync()).to.deep.equal({ sent: 0, taken: 0 })
    expect(one.storage.getItem('state-other')).to.equal(null)
  })

  it('chooses the default variant for a song id, ignores a state that is not JSON, and adds to settings already kept', async () => {
    const server = new Server()
    const one = await device(server)
    await one.db.saveSong(
      makeSong({ uuid: 'uuid-alt', id: 'title-two', isDefault: false, variantLabel: 'Alt' })
    )
    await one.db.saveSong(
      makeSong({
        uuid: 'uuid-main',
        id: 'title-two',
        isDefault: true,
        chordproFileId: 'chordpro-two',
      })
    )
    one.storage.setItem('state-set', '{not json')
    one.storage.setItem(
      `song-prefs-${one.db.spaceId}`,
      JSON.stringify({ 'title-two': { capo: 1 } })
    )
    expect(await one.sync()).to.deep.equal({ sent: 1, taken: 0 })
    expect(Object.keys(server.body.songs)).to.deep.equal(['uuid-main'])
    // (a device with settings of its own for another song keeps them when this one arrives)
    const two = await device(server)
    two.storage.setItem(
      `song-prefs-${two.db.spaceId}`,
      JSON.stringify({ 'title-song': { capo: 8 } })
    )
    await two.db.saveSong(
      makeSong({ uuid: 'uuid-main', id: 'title-two', chordproFileId: 'chordpro-two' })
    )
    await two.sync()
    expect(JSON.parse(two.storage.getItem(`song-prefs-${two.db.spaceId}`) ?? '')).to.deep.equal({
      'title-song': { capo: 8 },
      'title-two': { capo: 1 },
    })
  })

  it('takes an overlay with nothing in it as nothing kept', async () => {
    const server = new Server()
    const one = await device(server)
    server.set('setlists', 'set', {})
    one.storage.setItem('state-set', JSON.stringify({ capo: 2 }))
    expect(await one.sync()).to.deep.equal({ sent: 1, taken: 0 })
    server.set('setlists', 'set', {})
    expect(await one.sync()).to.deep.equal({ sent: 0, taken: 1 })
    expect(one.storage.getItem('state-set')).to.equal(null)
  })

  it('sends a great many items in one write', async () => {
    const server = new Server()
    const one = await device(server)
    for (let n = 0; n < 120; n++) {
      await one.db.saveSetlist(makeSetlist({ id: `s${n}`, songs: [] }))
      one.storage.setItem(`state-s${n}`, JSON.stringify({ n }))
    }
    expect((await one.sync()).sent).to.equal(120)
    expect(server.calls.filter(call => call.startsWith('PUT'))).to.have.length(1)
  })
})

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value')
  return value
}
