/** Church library charts sync as one versioned ChordPro/MusicXML bundle. PDFs stay out of this path. */
import type { ChordProRecord, ScoreRecord, SongRecord } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { normalizeTitle, parseTempo } from './db.ts'
import { ChordProParser } from './parser.ts'
import { chartFields } from './song-utils.ts'
import type { SpaceSong } from './space-data-types.ts'
import { t } from './text.ts'
import { ulid } from './ulid.ts'
import { sha256Hex } from './utils/bytes.ts'
import { hashText } from './utils/hash.ts'
import { callWorker, TeamError, type WorkerConnection } from './worker-call.ts'

interface SongBundle {
  format: 1
  chordpro: string
  musicxml: string | null
}
interface SongIndex {
  songs: SpaceSong[]
}
interface BundleResponse {
  song: SpaceSong
  bundle: SongBundle
}

export class LibrarySongSyncConflict extends Error {
  constructor() {
    super(t('library-song-sync-conflict'))
    this.name = 'LibrarySongSyncConflict'
  }
}

async function localBundle(db: ChordlessDB, song: SongRecord): Promise<SongBundle | null> {
  const chart = await db.getChordPro(song.chordproFileId)
  if (!chart) return null
  const score = await db.getScore(song.uuid)
  return { format: 1, chordpro: chart.content, musicxml: score?.xml ?? null }
}

const bundleHash = (bundle: SongBundle) => sha256Hex(JSON.stringify(bundle))

function metadata(song: SongRecord) {
  return {
    songId: song.id,
    title: song.title,
    ccli: song.ccliNumber,
    key: song.key,
    licence: song.licence ?? null,
    isDefault: song.isDefault,
    variantOf: song.variantOf,
    variantLabel: song.variantLabel,
  }
}

function remoteMetadata(song: SpaceSong) {
  return {
    songId: song.songId,
    title: song.title,
    ccli: song.ccli,
    key: song.key,
    licence: song.licence,
    isDefault: song.isDefault,
    variantOf: song.variantOf,
    variantLabel: song.variantLabel,
  }
}

function remoteMetadataFields(song: SpaceSong) {
  return {
    id: song.songId,
    title: song.title,
    titleNormalized: normalizeTitle(song.title),
    ccliNumber: song.ccli,
    key: song.key,
    licence: song.licence,
    isDefault: song.isDefault,
    variantOf: song.variantOf,
    variantLabel: song.variantLabel,
  }
}

const metadataHash = (value: ReturnType<typeof metadata>) => sha256Hex(JSON.stringify(value))

async function saveVersion(
  db: ChordlessDB,
  id: string,
  version: number,
  hash: string,
  sharedMetadataHash: string
) {
  await db.updateSong(id, song => {
    song.version = version
    song.libraryHash = hash
    song.libraryMetadataHash = sharedMetadataHash
  })
}

async function download(
  db: ChordlessDB,
  response: BundleResponse,
  previous?: SongRecord,
  expectedLocalHash?: string | null,
  preserveMetadata = false,
  expectedLocalMetadataHash?: string
) {
  const { song: remote, bundle } = response
  if (
    bundle.format !== 1 ||
    typeof bundle.chordpro !== 'string' ||
    !(bundle.musicxml === null || typeof bundle.musicxml === 'string')
  )
    throw new Error('The library returned an invalid song bundle')
  if ((await bundleHash(bundle)) !== remote.contentHash)
    throw new Error('The library song bundle failed its integrity check')
  const parser = new ChordProParser()
  const parsed = parser.parse(bundle.chordpro)
  const now = remote.modifiedAt
  const chordproFileId = previous?.chordproFileId ?? `chordpro-${ulid()}`
  const chartHash = hashText(bundle.chordpro)
  const fields = chartFields(parsed.metadata)
  const sharedMetadataHash = await metadataHash(remoteMetadata(remote))
  const record: SongRecord = {
    ...(previous ?? ({} as SongRecord)),
    uuid: remote.songUuid,
    id: preserveMetadata && previous ? previous.id : remote.songId,
    variantOf: preserveMetadata && previous ? previous.variantOf : remote.variantOf,
    isDefault: preserveMetadata && previous ? previous.isDefault : remote.isDefault,
    variantLabel: preserveMetadata && previous ? previous.variantLabel : remote.variantLabel,
    chordproFileId,
    ccliNumber: preserveMetadata && previous ? previous.ccliNumber : remote.ccli,
    title: preserveMetadata && previous ? previous.title : remote.title,
    titleNormalized: normalizeTitle(preserveMetadata && previous ? previous.title : remote.title),
    author: fields.author ?? null,
    copyright: fields.copyright ?? null,
    key: preserveMetadata && previous ? previous.key : (remote.key ?? fields.key ?? null),
    originalKey: fields.originalKey ?? null,
    tempo: previous?.tempo ?? parseTempo(fields.tempo).bpm,
    originalTempo: previous?.originalTempo ?? parseTempo(fields.originalTempo).bpm,
    time: fields.time ?? null,
    importDate: previous?.importDate ?? now,
    importUser: previous?.importUser ?? null,
    importSource: previous?.importSource ?? 'central-library',
    sourceUrl: previous?.sourceUrl ?? null,
    modifiedDate: now,
    fileRef: previous?.fileRef ?? null,
    fileModified: previous?.fileModified ?? null,
    lastSyncedAt: previous?.lastSyncedAt ?? null,
    contentHash: chartHash,
    version: remote.version,
    licence: preserveMetadata && previous ? previous.licence : remote.licence,
    libraryHash: remote.contentHash,
    libraryMetadataHash: sharedMetadataHash,
  }
  const chart: ChordProRecord = {
    id: chordproFileId,
    content: bundle.chordpro,
    contentHash: chartHash,
    ...(previous ? {} : { createdDate: now }),
    modifiedDate: now,
  }
  const oldScore = previous ? await db.getScore(remote.songUuid) : undefined
  const score: ScoreRecord | null =
    bundle.musicxml === null
      ? null
      : {
          uuid: remote.songUuid,
          xml: bundle.musicxml,
          key: fields.key ?? null,
          createdDate: oldScore?.createdDate ?? now,
          modifiedDate: now,
          contentHash: hashText(bundle.musicxml),
        }
  const current = await db.getSong(remote.songUuid)
  if (previous) {
    const currentBundle = current ? await localBundle(db, current) : null
    if (
      !current ||
      current.modifiedDate !== previous.modifiedDate ||
      (expectedLocalHash !== undefined &&
        (currentBundle ? await bundleHash(currentBundle) : null) !== expectedLocalHash) ||
      (expectedLocalMetadataHash !== undefined &&
        (await metadataHash(metadata(current))) !== expectedLocalMetadataHash)
    )
      throw new LibrarySongSyncConflict()
  } else if (current) {
    throw new LibrarySongSyncConflict()
  }
  await db.saveLibraryBundle(record, chart, score)
}

/** Pull remote updates and push local additions/edits. D1 versions prevent either side overwriting unseen work. */
export async function syncLibrarySongs(
  teamId: string,
  db: ChordlessDB,
  connection: WorkerConnection
): Promise<void> {
  await syncLibrarySongsAt(`/api/teams/${encodeURIComponent(teamId)}/library/songs`, db, connection)
}

/** The songs of the person's own library (a Personal space that has moved to the server) */
export async function syncPersonalLibrarySongs(
  libraryId: string,
  db: ChordlessDB,
  connection: WorkerConnection,
  options: SongSyncOptions = {}
): Promise<void> {
  await syncLibrarySongsAt(
    `/api/libraries/${encodeURIComponent(libraryId)}/songs`,
    db,
    connection,
    options
  )
}

export interface SongSyncOptions {
  /** Told how many of the songs to send have been sent, as they go (a move shows it) */
  progress?: (sent: number, total: number) => void
}

/** How many songs are sent at once: a move sends a hundred, and one at a time took a minute */
const UPLOADS_AT_ONCE = 4

/** Run `work` on each item, up to `limit` at once; the first failure stops it taking more and is what is thrown */
async function inParallel<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  let failure: unknown
  let failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next++]
      try {
        await work(item)
      } catch (error) {
        if (!failed) failure = error
        failed = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  if (failed) throw failure
}

/** The syncs of each library that are running or waiting, newest last: one goes at a time (see `syncLibrarySongsAt`) */
const running = new Map<string, Promise<unknown>>()

/**
 * One sync of a library's songs at a time. A move to the server sends a hundred songs one after another, which takes a
 * minute, and the app syncs by itself (a tick, a return to the page, a button) in that time: a second sync that lists
 * the library while the first is part way sends the songs the first has not reached yet, and the first then finds them
 * already there and is refused (409). The second waits for the first, then finds nothing to do. Another tab waits too,
 * where the browser has Web Locks.
 */
async function syncLibrarySongsAt(
  root: string,
  db: ChordlessDB,
  connection: WorkerConnection,
  options: SongSyncOptions = {}
): Promise<void> {
  const previous = running.get(root) ?? Promise.resolve()
  const turn = previous
    .catch(() => {})
    /* v8 ignore next 7 -- Web Locks is the browser's, for a second tab; Node has none, and the queue above is what the tests hold */
    .then(() =>
      navigator.locks
        ? navigator.locks.request(`chordless-library-songs-${root}`, () =>
            syncLibrarySongsNow(root, db, connection, options)
          )
        : syncLibrarySongsNow(root, db, connection, options)
    )
  running.set(root, turn)
  try {
    await turn
  } finally {
    if (running.get(root) === turn) running.delete(root)
  }
}

async function syncLibrarySongsNow(
  root: string,
  db: ChordlessDB,
  connection: WorkerConnection,
  { progress }: SongSyncOptions
): Promise<void> {
  const response = await callWorker({ path: root }, connection)
  const index = (await response.json()) as SongIndex
  if (!Array.isArray(index.songs)) throw new Error('The library returned an invalid song index')
  const remote = new Map(index.songs.map(song => [song.songUuid, song]))
  const local = new Map((await db.getAllSongs()).map(song => [song.uuid, song]))
  let conflict = false

  for (const [id, server] of remote) {
    const song = local.get(id)
    if (!song) {
      const result = await callWorker(
        { path: `${root}/${encodeURIComponent(id)}/bundle` },
        connection
      )
      await download(db, (await result.json()) as BundleResponse)
      continue
    }
    const bundle = await localBundle(db, song)
    if (!bundle) {
      const result = await callWorker(
        { path: `${root}/${encodeURIComponent(id)}/bundle` },
        connection
      )
      await download(db, (await result.json()) as BundleResponse, song, null)
      continue
    }
    const localHash = await bundleHash(bundle)
    const localMetaHash = await metadataHash(metadata(song))
    const serverMetaHash = await metadataHash(remoteMetadata(server))
    const baseMetaHash = song.libraryMetadataHash
    if (localHash === server.contentHash && localMetaHash === serverMetaHash) {
      await saveVersion(db, id, server.version, server.contentHash, serverMetaHash)
      continue
    }
    if (localHash === server.contentHash) {
      if (baseMetaHash === serverMetaHash) {
        await upload(root, db, song, bundle, server.version, connection)
      } else if (baseMetaHash === localMetaHash) {
        await db.updateSong(id, current =>
          Object.assign(current, remoteMetadataFields(server), {
            version: server.version,
            libraryHash: server.contentHash,
            libraryMetadataHash: serverMetaHash,
          })
        )
      } else {
        conflict = true
      }
      continue
    }
    const localMetaChanged = Boolean(baseMetaHash && localMetaHash !== baseMetaHash)
    const serverMetaChanged = Boolean(baseMetaHash && serverMetaHash !== baseMetaHash)
    if (song.libraryHash === server.contentHash) {
      if (!baseMetaHash && localMetaHash !== serverMetaHash) {
        conflict = true
        continue
      }
      if (localMetaChanged && serverMetaChanged && localMetaHash !== serverMetaHash) {
        conflict = true
        continue
      }
      if (baseMetaHash && !localMetaChanged && serverMetaChanged) {
        await db.updateSong(id, current =>
          Object.assign(current, remoteMetadataFields(server), {
            version: server.version,
            libraryHash: server.contentHash,
            libraryMetadataHash: serverMetaHash,
          })
        )
      }
      /* v8 ignore next -- the local snapshot is only a fallback if the record disappears during this same locked sync pass */
      const current = (await db.getSong(id)) ?? song
      await upload(root, db, current, bundle, server.version, connection)
      continue
    }
    if (song.libraryHash && localHash === song.libraryHash) {
      if (localMetaChanged && serverMetaChanged && localMetaHash !== serverMetaHash) {
        conflict = true
        continue
      }
      const result = await callWorker(
        { path: `${root}/${encodeURIComponent(id)}/bundle` },
        connection
      )
      const preserveMetadata = localMetaChanged && !serverMetaChanged
      await download(
        db,
        (await result.json()) as BundleResponse,
        song,
        localHash,
        preserveMetadata,
        localMetaHash
      )
      continue
    }
    if (
      !song.libraryHash ||
      (song.libraryHash !== server.contentHash && localHash !== song.libraryHash)
    ) {
      // A new device with an existing local chart, or two edits made offline: keep the local copy.
      conflict = true
    }
  }

  const toSend: [SongRecord, SongBundle][] = []
  for (const [id, song] of local) {
    if (remote.has(id)) continue
    const bundle = await localBundle(db, song)
    if (bundle) toSend.push([song, bundle])
  }
  let sent = 0
  progress?.(sent, toSend.length)
  await inParallel(toSend, UPLOADS_AT_ONCE, async ([song, bundle]) => {
    await upload(root, db, song, bundle, null, connection)
    progress?.(++sent, toSend.length)
  })
  if (conflict) throw new LibrarySongSyncConflict()
}

async function upload(
  root: string,
  db: ChordlessDB,
  snapshot: SongRecord,
  bundle: SongBundle,
  baseVersion: number | null,
  connection: WorkerConnection
): Promise<void> {
  const id = snapshot.uuid
  try {
    const response = await callWorker(
      {
        method: 'PUT',
        path: `${root}/${encodeURIComponent(id)}`,
        body: { baseVersion, song: metadata(snapshot), bundle },
      },
      connection
    )
    const saved = (await response.json()) as { song: SpaceSong }
    const current = await db.getSong(id)
    if (current) {
      // Only acknowledge the sent version. Changes made while R2 was writing remain dirty for the next tick.
      await saveVersion(
        db,
        id,
        saved.song.version,
        /* v8 ignore next -- the Worker always returns contentHash; this protects against a nonconforming response */
        saved.song.contentHash ?? (await bundleHash(bundle)),
        await metadataHash(metadata(snapshot))
      )
    }
  } catch (error) {
    if (error instanceof TeamError && error.status === 403) return
    if (error instanceof TeamError && error.status === 409) throw new LibrarySongSyncConflict()
    throw error
  }
}
