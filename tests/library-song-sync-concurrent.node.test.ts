/**
 * Two syncs of one library at once (a move to the server sends a hundred songs for a minute, and the app syncs by itself
 * meanwhile): the second must not send the songs the first has not reached, or the first is refused for them.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SongRecord } from '../src/js/data-types.ts'
import type { ChordlessDB } from '../src/js/db.ts'
import { syncPersonalLibrarySongs } from '../src/js/library-song-sync.ts'
import { sha256Hex } from '../src/js/utils/bytes.ts'
import type { WorkerConnection } from '../src/js/worker-call.ts'

const later = () => new Promise(done => setTimeout(done, 1))

const song = (n: number): SongRecord =>
  ({
    uuid: `u${n}`,
    id: `title-${n}`,
    variantOf: null,
    isDefault: true,
    variantLabel: '',
    chordproFileId: `c${n}`,
    ccliNumber: null,
    title: `Song ${n}`,
    titleNormalized: `song ${n}`,
    key: 'G',
    version: undefined,
  }) as unknown as SongRecord

test('a second sync of a library waits for the first, and finds nothing left to send', async () => {
  const songs = new Map<string, SongRecord>(
    Array.from({ length: 12 }, (_, n) => [`u${n}`, song(n)])
  )
  const db = {
    async getAllSongs() {
      return [...songs.values()].map(each => ({ ...each }))
    },
    async getSong(id: string) {
      return songs.has(id) ? { ...(songs.get(id) as SongRecord) } : undefined
    },
    async getChordPro(id: string) {
      return { id, content: `{title: ${id}}\n[G]${id}`, contentHash: id }
    },
    async getScore() {
      return undefined
    },
    async updateSong(id: string, change: (value: SongRecord) => unknown) {
      const draft = { ...(songs.get(id) as SongRecord) }
      change(draft)
      songs.set(id, draft)
      return draft
    },
  } as unknown as ChordlessDB

  const server = new Map<
    string,
    { version: number; contentHash: string; song: Record<string, unknown> }
  >()
  let puts = 0
  let refused = 0
  const connection: WorkerConnection = {
    token: async () => 't',
    origin: 'https://example.test',
    async fetch(input, init) {
      const path = new URL(String(input)).pathname
      if (init?.method === 'PUT') {
        puts++
        await later()
        const id = decodeURIComponent(path.split('/').at(-1) as string)
        const sent = JSON.parse(String(init.body)) as {
          baseVersion: number | null
          song: Record<string, unknown>
          bundle: unknown
        }
        if (server.has(id) && server.get(id)?.version !== sent.baseVersion) {
          refused++
          return Response.json({ error: 'Song changed elsewhere' }, { status: 409 })
        }
        const contentHash = await sha256Hex(JSON.stringify(sent.bundle))
        const version = (server.get(id)?.version ?? 0) + 1
        server.set(id, { version, contentHash, song: { songUuid: id, ...sent.song } })
        return Response.json({ song: { songUuid: id, version, contentHash } }, { status: 201 })
      }
      return Response.json({
        songs: [...server.entries()].map(([id, each]) => ({
          songUuid: id,
          songId: each.song.songId,
          title: each.song.title,
          ccli: null,
          key: each.song.key,
          licence: null,
          isDefault: true,
          variantOf: null,
          variantLabel: '',
          contentHash: each.contentHash,
          version: each.version,
        })),
      })
    },
  }

  // Both start together, as a move and the app's own tick do
  await Promise.all([
    syncPersonalLibrarySongs('lib', db, connection),
    syncPersonalLibrarySongs('lib', db, connection),
  ])
  assert.equal(refused, 0, 'no song was sent twice')
  assert.equal(puts, 12)
  assert.equal(server.size, 12)
  // (and a third later has nothing to do)
  await syncPersonalLibrarySongs('lib', db, connection)
  assert.equal(puts, 12)
})

test('a sync that fails does not stop the next one from running', async () => {
  const db = {
    async getAllSongs() {
      return []
    },
  } as unknown as ChordlessDB
  let calls = 0
  const connection: WorkerConnection = {
    token: async () => 't',
    origin: 'https://example.test',
    async fetch() {
      calls++
      return calls === 1
        ? Response.json({ error: 'Down' }, { status: 500 })
        : Response.json({ songs: [] })
    },
  }
  const first = syncPersonalLibrarySongs('lib2', db, connection)
  const second = syncPersonalLibrarySongs('lib2', db, connection)
  await assert.rejects(first)
  await second
  assert.equal(calls, 2)
})

/** A library of `count` songs on the device, and a server that takes them, recording how many PUTs were in flight at once */
function fixture(count: number, refuse: (id: string) => boolean = () => false) {
  const songs = new Map<string, SongRecord>(
    Array.from({ length: count }, (_, n) => [`u${n}`, song(n)])
  )
  const db = {
    async getAllSongs() {
      return [...songs.values()].map(each => ({ ...each }))
    },
    async getSong(id: string) {
      return songs.has(id) ? { ...(songs.get(id) as SongRecord) } : undefined
    },
    async getChordPro(id: string) {
      return { id, content: `{title: ${id}}`, contentHash: id }
    },
    async getScore() {
      return undefined
    },
    async updateSong(id: string, change: (value: SongRecord) => unknown) {
      const draft = { ...(songs.get(id) as SongRecord) }
      change(draft)
      songs.set(id, draft)
      return draft
    },
  } as unknown as ChordlessDB
  const stats = { inFlight: 0, peak: 0, sent: [] as string[] }
  const connection: WorkerConnection = {
    token: async () => 't',
    origin: 'https://example.test',
    async fetch(input, init) {
      if (init?.method !== 'PUT') return Response.json({ songs: [] })
      const id = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1) as string)
      stats.inFlight++
      stats.peak = Math.max(stats.peak, stats.inFlight)
      await later()
      await later()
      stats.inFlight--
      if (refuse(id)) return Response.json({ error: 'Song changed elsewhere' }, { status: 409 })
      stats.sent.push(id)
      return Response.json(
        { song: { songUuid: id, version: 1, contentHash: 'h' } },
        { status: 201 }
      )
    },
  }
  return { db, connection, stats }
}

test('songs are sent several at a time, no more than four, and each is told as it goes', async () => {
  const { db, connection, stats } = fixture(20)
  const told: [number, number][] = []
  await syncPersonalLibrarySongs('lib3', db, connection, {
    progress: (sent, total) => told.push([sent, total]),
  })
  assert.equal(stats.sent.length, 20)
  assert.ok(stats.peak > 1 && stats.peak <= 4, `at once: ${stats.peak}`)
  assert.deepEqual(told[0], [0, 20], 'it says how many there are before it starts')
  assert.deepEqual(told.at(-1), [20, 20])
  assert.deepEqual(
    told.map(([sent]) => sent),
    Array.from({ length: 21 }, (_, n) => n),
    'one more each time'
  )
})

test('a song that is refused stops the sending of the rest, and is what the sync fails with', async () => {
  const { db, connection, stats } = fixture(40, id => id === 'u5')
  await assert.rejects(
    syncPersonalLibrarySongs('lib4', db, connection),
    /changed on another device/
  )
  assert.ok(stats.sent.length < 39, `the rest were not all sent: ${stats.sent.length}`)
})

test('a library with nothing to send says so, and sends nothing', async () => {
  const { db, connection, stats } = fixture(0)
  const told: [number, number][] = []
  await syncPersonalLibrarySongs('lib5', db, connection, {
    progress: (sent, total) => told.push([sent, total]),
  })
  assert.deepEqual(told, [[0, 0]])
  assert.equal(stats.sent.length, 0)
})

test('a song the church already has, under another id, is taken in place of this device’s own, and its setlists follow', async () => {
  // The church's library holds the chart as `team-a-holy`; this device (the other team's) has the same chart as `team-b-holy`
  const chordpro = '{title: Holy}\n{key: G}\n[G]Holy, holy'
  const bundle = { format: 1 as const, chordpro, musicxml: null }
  const contentHash = await sha256Hex(JSON.stringify(bundle))
  const canonical = {
    songUuid: 'team-a-holy',
    songId: 'title-holy',
    title: 'Holy',
    ccli: null,
    key: 'G',
    licence: null,
    isDefault: true,
    variantOf: null,
    variantLabel: '',
    contentHash,
    fileRef: null,
    version: 1,
    modifiedAt: '2026-11-27T00:00:00.000Z',
  }
  const songs = new Map<string, SongRecord>([
    [
      'team-b-holy',
      { ...song(1), uuid: 'team-b-holy', id: 'title-holy', title: 'Holy' } as SongRecord,
    ],
  ])
  const chordpros = new Map<string, { id: string; content: string; contentHash: string }>([
    ['c1', { id: 'c1', content: chordpro, contentHash: 'x' }],
  ])
  const setlists = [
    {
      id: 'S1',
      songs: [
        { songUuid: 'team-b-holy', songId: 'title-holy' },
        { songUuid: 'other', songId: 'title-other' },
      ],
    },
    { id: 'S2', songs: [{ songUuid: 'unrelated', songId: 'title-unrelated' }] },
  ]
  const deleted: [string, unknown][] = []
  const edited: string[] = []
  const db = {
    async getAllSongs() {
      return [...songs.values()].map(each => ({ ...each }))
    },
    async getSong(id: string) {
      return songs.has(id) ? { ...(songs.get(id) as SongRecord) } : undefined
    },
    async getChordPro(id: string) {
      return chordpros.get(id === 'chart-1' ? 'c1' : id) ?? chordpros.get('c1')
    },
    async getScore() {
      return undefined
    },
    async updateSong(id: string, change: (value: SongRecord) => unknown) {
      const draft = { ...(songs.get(id) as SongRecord) }
      change(draft)
      songs.set(id, draft)
      return draft
    },
    async getAllSetlists() {
      return setlists
    },
    async updateSetlist(id: string, change: (value: (typeof setlists)[number]) => unknown) {
      edited.push(id)
      change(setlists.find(each => each.id === id) as (typeof setlists)[number])
    },
    async deleteSong(id: string, options: unknown) {
      deleted.push([id, options])
      songs.delete(id)
    },
    async saveLibraryBundle(
      record: SongRecord,
      chart: { id: string; content: string; contentHash: string }
    ) {
      songs.set(record.uuid, { ...record })
      chordpros.set(chart.id, chart)
    },
  } as unknown as ChordlessDB
  let putTo = ''
  const connection: WorkerConnection = {
    token: async () => 't',
    origin: 'https://example.test',
    async fetch(input, init) {
      const path = new URL(String(input)).pathname
      if (init?.method === 'PUT') {
        putTo = decodeURIComponent(path.split('/').at(-1) as string)
        return Response.json({ song: canonical, mergedInto: 'team-a-holy' })
      }
      if (path.endsWith('/team-a-holy/bundle')) return Response.json({ song: canonical, bundle })
      return Response.json({ songs: [canonical] })
    },
  }
  // (the library lists the song it has; this device's own is not on it, so it is sent, and the Worker says it is there already)
  await syncPersonalLibrarySongs('lib-merge', db, connection)
  assert.equal(putTo, 'team-b-holy')
  assert.deepEqual(
    setlists[0].songs.map(entry => entry.songUuid),
    ['team-a-holy', 'other'],
    'the setlist names the song that is there'
  )
  assert.deepEqual(
    setlists[1].songs.map(entry => entry.songUuid),
    ['unrelated'],
    'another setlist is left as it is'
  )
  assert.deepEqual(edited, ['S1'], 'only a setlist that named the song was changed')
  assert.deepEqual(
    deleted,
    [['team-b-holy', { remember: false }]],
    'its own copy goes, and is not remembered as deleted'
  )
  assert.ok(songs.has('team-a-holy'), 'the one that is there was brought in by the pass after')
  assert.equal(songs.has('team-b-holy'), false)
})
