import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { syncOverlays } from '../src/js/overlay-sync.ts'
import { makeEntry, makeSetlist, makeSong } from './builders.ts'
import { deleteDatabase } from './test-helpers.ts'

const { describe, it, afterEach } = window

/** What the server keeps: the Worker's rules in a few lines, enough to test the other side of them */
class Server {
  items = new Map<string, { version: number; body: unknown }>()
  calls: string[] = []
  refuse = new Set<string>()
  fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    this.calls.push(`${init?.method ?? 'GET'} ${url.pathname}`)
    if (url.pathname.endsWith('/batch')) {
      const { ops } = JSON.parse(String(init?.body)) as { ops: Record<string, unknown>[] }
      return Response.json({ results: ops.map(op => this.apply(op)) })
    }
    const out = { preferences: null as unknown, setlists: [] as unknown[], songs: [] as unknown[] }
    for (const [key, item] of this.items) {
      if (key === 'preferences') out.preferences = item
      else if (key.startsWith('setlist:')) out.setlists.push({ setlistId: key.slice(8), ...item })
      else out.songs.push({ libraryId: 'lib', songUuid: key.slice(5), ...item })
    }
    return Response.json(out)
  }) as typeof fetch
  keyOf(op: Record<string, unknown>) {
    return op.kind === 'preferences'
      ? 'preferences'
      : op.kind === 'setlist'
        ? `setlist:${op.setlistId}`
        : `song:${op.songUuid}`
  }
  apply(op: Record<string, unknown>) {
    const key = this.keyOf(op)
    if (this.refuse.has(key)) return { status: 'forbidden' }
    const have = this.items.get(key)
    if (op.op === 'delete') {
      this.items.delete(key)
      return { status: 'ok', version: 0 }
    }
    if ((have?.version ?? null) !== op.baseVersion) return { status: 'conflict', current: have }
    const version = (have?.version ?? 0) + 1
    this.items.set(key, { version, body: op.body })
    return { status: 'ok', version }
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
      libraryId: 'lib',
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
    expect(server.items.get('setlist:set')?.body).to.deep.equal({
      state: { capo: 2, annotations: ['a'] },
    })
    expect(server.items.get('song:uuid-song')?.body).to.deep.equal({ capo: 3, padSetId: 'SET1' })
    expect(server.items.get('preferences')?.body).to.deep.equal({ musician_type: 'guitarist' })
    expect(server.items.size).to.equal(
      3,
      'a song the device does not have, and the theme, are not sent'
    )
  })

  it('sends nothing again when nothing changed, and only what did when something has', async () => {
    const server = new Server()
    const one = await device(server)
    one.storage.setItem('state-set', JSON.stringify({ capo: 2 }))
    one.storage.setItem('pitch', 'Bb')
    await one.sync()
    expect(await one.sync()).to.deep.equal({ sent: 0, taken: 0 })
    one.storage.setItem('state-set', JSON.stringify({ capo: 4 }))
    expect(await one.sync()).to.deep.equal({ sent: 1, taken: 0 })
    expect(server.items.get('setlist:set')).to.deep.equal({
      version: 2,
      body: { state: { capo: 4 } },
    })
    expect(server.items.get('preferences')?.version).to.equal(1)
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
    expect(
      ((server.items.get('setlist:set')?.body ?? {}) as { local?: unknown[] }).local
    ).to.have.length(1)
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
    expect(server.items.get('setlist:set')?.body).to.deep.equal({ state: { capo: 9 } })
  })

  it('sends a removal, and does not clear what is kept when the server stops showing it', async () => {
    const server = new Server()
    const one = await device(server)
    one.storage.setItem('state-set', JSON.stringify({ capo: 2 }))
    await one.sync()
    one.storage.removeItem('state-set')
    expect(await one.sync()).to.deep.equal({ sent: 1, taken: 0 })
    expect(server.items.has('setlist:set')).to.equal(false)
    // (the person left the church: the server shows nothing, and the device keeps its own)
    one.storage.setItem('state-set', JSON.stringify({ capo: 3 }))
    await one.sync()
    server.items.clear()
    expect(await one.sync()).to.deep.equal({ sent: 0, taken: 0 })
    expect(JSON.parse(one.storage.getItem('state-set') ?? '')).to.deep.equal({ capo: 3 })
  })

  it('leaves alone what the server refuses, and takes nothing for a setlist or song it does not have yet', async () => {
    const server = new Server()
    const one = await device(server)
    one.storage.setItem('state-set', JSON.stringify({ capo: 2 }))
    one.storage.setItem('pitch', 'F')
    server.refuse.add('setlist:set')
    expect(await one.sync()).to.deep.equal({ sent: 1, taken: 0 })
    server.items.set('setlist:other', { version: 1, body: { state: { capo: 1 } } })
    server.items.set('song:other', { version: 1, body: { capo: 1 } })
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
    expect([...server.items.keys()]).to.deep.equal(['song:uuid-main'])
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
    server.items.set('setlist:set', { version: 1, body: {} })
    one.storage.setItem('state-set', JSON.stringify({ capo: 2 }))
    expect(await one.sync()).to.deep.equal({ sent: 1, taken: 0 })
    server.items.set('setlist:set', { version: 5, body: {} })
    expect(await one.sync()).to.deep.equal({ sent: 0, taken: 1 })
    expect(one.storage.getItem('state-set')).to.equal(null)
  })

  it('sends more than a hundred items in more than one batch', async () => {
    const server = new Server()
    const one = await device(server)
    for (let n = 0; n < 120; n++) {
      await one.db.saveSetlist(makeSetlist({ id: `s${n}`, songs: [] }))
      one.storage.setItem(`state-s${n}`, JSON.stringify({ n }))
    }
    expect((await one.sync()).sent).to.equal(120)
    expect(server.calls.filter(call => call.endsWith('/batch'))).to.have.length(2)
  })
})

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value')
  return value
}
