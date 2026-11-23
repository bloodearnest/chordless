import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ScoreRecord, SongRecord } from '../src/js/data-types.ts'
import type { ChordlessDB } from '../src/js/db.ts'
import { LibrarySongSyncConflict, syncLibrarySongs } from '../src/js/library-song-sync.ts'
import type { SpaceSong } from '../src/js/space-data-types.ts'
import { sha256Hex } from '../src/js/utils/bytes.ts'
import { hashText } from '../src/js/utils/hash.ts'
import type { WorkerConnection } from '../src/js/worker-call.ts'

const chart = (body: string) => `{title: Song}\n${body}`
const makeSong = (content: string): SongRecord => ({
  uuid: 'song-1',
  id: 'title-song',
  variantOf: null,
  isDefault: true,
  variantLabel: '',
  chordproFileId: 'chart-1',
  ccliNumber: null,
  title: 'Song',
  titleNormalized: 'song',
  author: null,
  copyright: null,
  key: 'G',
  originalKey: 'G',
  tempo: null,
  originalTempo: null,
  time: null,
  importDate: '2026-11-23T00:00:00.000Z',
  importUser: null,
  importSource: 'test',
  sourceUrl: null,
  modifiedDate: '2026-11-23T00:00:00.000Z',
  fileRef: null,
  fileModified: null,
  lastSyncedAt: null,
  contentHash: hashText(content),
})

test('library song sync reconciles offline charts, metadata and conflicts without losing local work', async () => {
  let localSong: SongRecord | undefined = makeSong(chart('Original'))
  let localChart: { id: string; content: string; contentHash: string } | null = {
    id: 'chart-1',
    content: chart('Original'),
    contentHash: hashText(chart('Original')),
  }
  let localScore: ScoreRecord | undefined = {
    uuid: 'song-1',
    xml: '<score-partwise/>',
    key: 'G',
    createdDate: '2026-11-23T00:00:00.000Z',
    modifiedDate: '2026-11-23T00:00:00.000Z',
    contentHash: hashText('<score-partwise/>'),
  }
  const chartNow = () => localChart as { id: string; content: string; contentHash: string } | null
  const songNow = () => localSong as SongRecord | undefined
  const scoreNow = () => localScore as ScoreRecord | undefined
  const central: {
    song: SpaceSong | null
    bundle: { format: 1; chordpro: string; musicxml: string | null } | null
  } = { song: null, bundle: null }
  let denyWrites = false
  let conflictOnWrite = false
  let failWrites = false
  let insertDuringList = false
  let invalidIndex = false
  let invalidBundle = false
  let disappearOnRead = false
  const db = {
    async getAllSongs() {
      if (insertDuringList) {
        insertDuringList = false
        localSong = makeSong(chart('Raced local record'))
        localChart = {
          id: 'chart-1',
          content: chart('Raced local record'),
          contentHash: hashText(chart('Raced local record')),
        }
        return []
      }
      return localSong ? [{ ...localSong }] : []
    },
    async getSong(id: string) {
      if (disappearOnRead) {
        disappearOnRead = false
        return undefined
      }
      return localSong?.uuid === id ? { ...localSong } : undefined
    },
    async getChordPro() {
      return localChart ? { ...localChart } : undefined
    },
    async getScore() {
      return localScore
    },
    async updateSong(id: string, change: (song: SongRecord) => unknown) {
      if (!localSong || localSong.uuid !== id) return undefined
      const draft = { ...localSong }
      change(draft)
      localSong = draft
      return draft
    },
    async saveLibraryBundle(
      song: SongRecord,
      savedChart: NonNullable<typeof localChart>,
      savedScore: ScoreRecord | null
    ) {
      localSong = { ...song }
      localChart = { ...savedChart }
      localScore = savedScore ?? undefined
    },
  } as unknown as ChordlessDB

  const connection: WorkerConnection = {
    token: async () => 'token',
    origin: 'https://example.test',
    async fetch(input, init) {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/library/songs') && init?.method === 'GET') {
        if (invalidIndex) return Response.json({ songs: null })
        return Response.json({ songs: central.song ? [central.song] : [] })
      }
      if (path.endsWith('/song-1/bundle')) {
        if (invalidBundle)
          return Response.json({
            song: central.song,
            bundle: { format: 2, chordpro: 'x', musicxml: null },
          })
        return central.song && central.bundle
          ? Response.json({ song: central.song, bundle: central.bundle })
          : Response.json({ error: 'missing' }, { status: 404 })
      }
      assert.equal(init?.method, 'PUT')
      if (denyWrites) return Response.json({ error: 'reader' }, { status: 403 })
      if (conflictOnWrite) return Response.json({ error: 'conflict' }, { status: 409 })
      if (failWrites) return Response.json({ error: 'failed' }, { status: 500 })
      const request = JSON.parse(String(init.body)) as {
        baseVersion: number | null
        song: Omit<SpaceSong, 'songUuid' | 'version' | 'modifiedAt' | 'contentHash' | 'fileRef'>
        bundle: NonNullable<typeof central.bundle>
      }
      if ((central.song?.version ?? null) !== request.baseVersion)
        return Response.json({ error: 'conflict' }, { status: 409 })
      central.bundle = request.bundle
      central.song = {
        ...request.song,
        songUuid: 'song-1',
        version: (central.song?.version ?? 0) + 1,
        modifiedAt: new Date().toISOString(),
        contentHash: await sha256Hex(JSON.stringify(central.bundle)),
        fileRef: null,
      }
      return Response.json({ song: central.song })
    },
  }

  await syncLibrarySongs('team-1', db, connection)
  assert.equal(central.song?.version, 1)
  assert.equal(localSong?.version, 1)
  assert.equal(localSong?.libraryHash, central.song?.contentHash)
  assert.equal(central.bundle?.musicxml, '<score-partwise/>')
  assert.ok(central.song)
  const initialCentralSong = central.song
  const initialBundle = central.bundle
  central.bundle = { format: 1, chordpro: chart('Concurrent remote change'), musicxml: null }
  central.song = {
    ...central.song,
    version: 2,
    contentHash: await sha256Hex(JSON.stringify(central.bundle)),
  }
  disappearOnRead = true
  await assert.rejects(syncLibrarySongs('team-1', db, connection), LibrarySongSyncConflict)
  assert.equal(
    localChart?.content,
    chart('Original'),
    'a concurrent local deletion is not recreated'
  )
  central.song = initialCentralSong
  central.bundle = initialBundle
  invalidIndex = true
  await assert.rejects(syncLibrarySongs('team-1', db, connection), /invalid song index/)
  invalidIndex = false

  await syncLibrarySongs('team-1', db, connection)
  assert.equal(central.song?.version, 1, 'an unchanged bundle and metadata are a no-op')
  assert.ok(localSong)
  localSong = { ...localSong, key: 'A', modifiedDate: new Date().toISOString() }
  await syncLibrarySongs('team-1', db, connection)
  assert.equal(central.song?.key, 'A', 'local metadata changes upload')
  assert.equal(central.song?.version, 2)

  assert.ok(central.song)
  central.song = { ...central.song, key: 'B', version: 3 }
  await syncLibrarySongs('team-1', db, connection)
  assert.equal(localSong?.key, 'B', 'remote metadata changes apply')

  localChart = null
  await syncLibrarySongs('team-1', db, connection)
  assert.equal(chartNow()?.content, chart('Original'), 'a missing local chart is downloaded')

  assert.ok(central.song)
  central.bundle = {
    format: 1,
    chordpro: '{title: Song}\n{key: D}\nChanged remotely',
    musicxml: '<score-partwise><part/></score-partwise>',
  }
  central.song = {
    ...central.song,
    key: null,
    version: 4,
    contentHash: await sha256Hex(JSON.stringify(central.bundle)),
  }
  await syncLibrarySongs('team-1', db, connection)
  assert.equal(chartNow()?.content, '{title: Song}\n{key: D}\nChanged remotely')
  assert.equal(localSong?.key, 'D', 'a missing central key falls back to the chart key')
  assert.equal(localScore?.xml, '<score-partwise><part/></score-partwise>')
  assert.equal(localSong?.version, 4)

  assert.ok(localSong)
  assert.ok(central.song)
  localSong = { ...localSong, key: 'C', modifiedDate: new Date().toISOString() }
  central.bundle = { format: 1, chordpro: chart('Changed remotely again'), musicxml: null }
  central.song = {
    ...central.song,
    version: 5,
    contentHash: await sha256Hex(JSON.stringify(central.bundle)),
  }
  await syncLibrarySongs('team-1', db, connection)
  assert.equal(
    localSong.key,
    'C',
    'an unrelated local metadata edit survives a remote chart change'
  )
  assert.equal(chartNow()?.content, chart('Changed remotely again'))
  assert.equal(scoreNow(), undefined, 'remote bundle removal deletes the local MusicXML')
  await syncLibrarySongs('team-1', db, connection)
  assert.equal(central.song?.key, 'C', 'the retained metadata edit syncs on the next pass')
  assert.equal(central.song?.version, 6)

  const chartToEdit = chartNow()
  assert.ok(chartToEdit)
  localChart = {
    ...chartToEdit,
    content: chart('Changed here'),
    contentHash: hashText(chart('Changed here')),
  }
  assert.ok(localSong)
  assert.ok(central.song)
  localSong = { ...localSong, modifiedDate: new Date().toISOString() }
  central.bundle = { format: 1, chordpro: chart('Changed elsewhere'), musicxml: null }
  central.song = {
    ...central.song,
    version: 7,
    contentHash: await sha256Hex(JSON.stringify(central.bundle)),
  }
  await assert.rejects(syncLibrarySongs('team-1', db, connection), LibrarySongSyncConflict)
  assert.equal(chartNow()?.content, chart('Changed here'))

  assert.ok(localSong)
  assert.ok(central.song)
  localChart = {
    id: 'chart-1',
    content: chart('Changed remotely again'),
    contentHash: hashText(chart('Changed remotely again')),
  }
  const priorMetadataHash = localSong.libraryMetadataHash
  localSong = { ...localSong, key: 'D', modifiedDate: new Date().toISOString() }
  central.song = { ...central.song, key: 'E' }
  central.bundle = {
    format: 1,
    chordpro: chart('Changed elsewhere'),
    musicxml: null,
  }
  central.song = {
    ...central.song,
    contentHash: await sha256Hex(JSON.stringify(central.bundle)),
    version: 8,
  }
  await assert.rejects(syncLibrarySongs('team-1', db, connection), LibrarySongSyncConflict)

  assert.ok(localSong)
  localSong = {
    ...localSong,
    libraryHash: central.song.contentHash,
    libraryMetadataHash: undefined,
  }
  await assert.rejects(syncLibrarySongs('team-1', db, connection), LibrarySongSyncConflict)

  assert.ok(localSong)
  assert.ok(central.song)
  const centralBundle = central.bundle
  assert.ok(centralBundle)
  localChart = {
    id: 'chart-1',
    content: centralBundle.chordpro,
    contentHash: hashText(centralBundle.chordpro),
  }
  localSong = {
    ...localSong,
    key: 'F',
    libraryHash: central.song.contentHash,
    libraryMetadataHash: priorMetadataHash,
  }
  await assert.rejects(syncLibrarySongs('team-1', db, connection), LibrarySongSyncConflict)

  assert.ok(localSong)
  assert.ok(central.song)
  localSong = {
    ...localSong,
    key: 'C',
    libraryHash: central.song.contentHash,
    libraryMetadataHash: priorMetadataHash,
  }
  localChart = {
    id: 'chart-1',
    content: chart('Metadata merge chart edit'),
    contentHash: hashText(chart('Metadata merge chart edit')),
  }
  central.song = { ...central.song, key: 'G' }
  await syncLibrarySongs('team-1', db, connection)
  assert.equal(localSong?.key, 'G', 'remote metadata applies alongside a local chart edit')

  assert.ok(localSong)
  assert.ok(central.song)
  localSong = { ...localSong, key: 'A' }
  localChart = {
    id: 'chart-1',
    content: chart('Second local chart edit'),
    contentHash: hashText(chart('Second local chart edit')),
  }
  central.song = { ...central.song, key: 'B' }
  await assert.rejects(syncLibrarySongs('team-1', db, connection), LibrarySongSyncConflict)

  insertDuringList = true
  await assert.rejects(syncLibrarySongs('team-1', db, connection), LibrarySongSyncConflict)

  localSong = undefined
  localChart = null
  await syncLibrarySongs('team-1', db, connection)
  assert.equal(
    chartNow()?.content,
    chart('Metadata merge chart edit'),
    'a song missing on this device is downloaded'
  )

  assert.ok(central.song)
  const validRemoteHash = central.song.contentHash
  central.song = { ...central.song, contentHash: 'not-the-bundle-hash' }
  localSong = undefined
  localChart = null
  await assert.rejects(syncLibrarySongs('team-1', db, connection), /integrity check/)
  central.song = { ...central.song, contentHash: validRemoteHash }
  invalidBundle = true
  await assert.rejects(syncLibrarySongs('team-1', db, connection), /invalid song bundle/)
  invalidBundle = false

  assert.ok(central.song)
  central.bundle = {
    format: 1,
    chordpro: chart('No key in chart'),
    musicxml: '<score-partwise/>',
  }
  central.song = {
    ...central.song,
    key: null,
    contentHash: await sha256Hex(JSON.stringify(central.bundle)),
    version: central.song.version + 1,
  }
  localSong = undefined
  localChart = null
  localScore = undefined
  await syncLibrarySongs('team-1', db, connection)
  assert.equal(songNow()?.key, null, 'a song without a central or chart key remains unset')
  assert.equal(
    scoreNow()?.createdDate,
    central.song.modifiedAt,
    'new MusicXML gets a creation date'
  )

  central.song = null
  central.bundle = null
  localSong = {
    ...makeSong(chart('Reader local')),
    uuid: 'reader-song',
    chordproFileId: 'reader-chart',
  }
  localChart = {
    id: 'reader-chart',
    content: chart('Reader local'),
    contentHash: hashText(chart('Reader local')),
  }
  denyWrites = true
  await syncLibrarySongs('team-1', db, connection)
  assert.equal(
    localSong.version,
    undefined,
    'a reader keeps a local-only song without writing it back'
  )
  denyWrites = false
  conflictOnWrite = true
  await assert.rejects(syncLibrarySongs('team-1', db, connection), LibrarySongSyncConflict)
  conflictOnWrite = false
  failWrites = true
  assert.ok(localSong)
  localSong = { ...localSong, key: 'Z', modifiedDate: new Date().toISOString() }
  await assert.rejects(syncLibrarySongs('team-1', db, connection), /failed/)
  failWrites = false
  central.song = null
  central.bundle = null
  localSong = makeSong(chart('No chart'))
  localChart = null
  await syncLibrarySongs('team-1', db, connection)
  assert.equal(central.song, null, 'a local record without a chart is not uploaded')
})
