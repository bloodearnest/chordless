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
