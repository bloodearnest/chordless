import type {
  ChordProRecord,
  PendingDeletion,
  Setlist,
  SetlistLocalState,
  SongInput,
  SongRecord,
  TempoInput,
} from './data-types.ts'
import { noteLocalChange } from './local-changes.ts'
import { songSource } from './song-source.ts'
import { setlistContentHash } from './sync/setlist-hash.ts'
import { parseLocalDate, toLocalDateString } from './utils/date-utils.ts'
import { requestResult, transactionDone } from './utils/idb.ts'
import { ensurePersistentStorage } from './utils/persistence.ts'

// IndexedDB wrapper for database operations
// Manages space-specific data: songs, chordpro content, setlists, and local state
//
// NOTE: This now stores ALL space data in one database per space.
// Space metadata is stored separately in the 'spaces' database.

const DB_VERSION = 9

// Setlist types
export const SETLIST_TYPES: Readonly<Record<string, string>> = {
  CHURCH_SERVICE: 'Church Service',
  PRAYER_MEETING: 'Prayer Meeting',
  EVENT: 'Event',
  OTHER: 'Other',
}

/**
 * A copy of a value that IndexedDB can store: dates as ISO strings, functions, symbols and
 * promises dropped. What goes in is what comes out, apart from those.
 */
function cloneForStorage(value: unknown, path = ''): unknown {
  if (value === null || value === undefined) {
    return value
  }

  // Primitive values can be stored as-is
  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => cloneForStorage(item, `${path}[${index}]`))
  }

  if (type === 'object') {
    const object = value as Record<string, unknown>
    if (typeof object.then === 'function' && typeof object.catch === 'function') {
      console.warn(`[ChordlessDB] Dropping Promise at ${path || '<root>'} before storage`)
      return null
    }

    const cloned: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(object)) {
      if (typeof val === 'function' || typeof val === 'symbol') {
        console.warn(
          `[ChordlessDB] Dropping non-serializable property ${path ? `${path}.` : ''}${key}`
        )
        continue
      }
      const sanitized = cloneForStorage(val, path ? `${path}.${key}` : key)
      if (sanitized !== undefined) {
        cloned[key] = sanitized
      }
    }
    return cloned
  }

  // A BigInt is stored as a string
  if (type === 'bigint') {
    return (value as bigint).toString()
  }

  // A function or symbol, in a list (as a property it is dropped and warned about above)
  return undefined
}

/** A time a song was played in a setlist (see getSongUsageFromSetlists) */
export interface SongUsage {
  setlistId: string
  setlistDate: string
  setlistName: string
  leader: string
  type: string
  playedInKey: string | null
  order: number
}

export class ChordlessDB {
  dbName: string
  spaceId: string
  db: IDBDatabase | null
  /**
   * Saves and deletes here are not told to the sync as changes to send (`noteLocalChange`): the
   * database of a sync's own, whose writes are what came from storage
   */
  quiet = false

  constructor(spaceId: string) {
    if (!spaceId) {
      throw new Error('spaceId is required for ChordlessDB')
    }

    // Database name is just the space ID
    // This allows renaming spaces without database migration
    this.dbName = spaceId
    this.spaceId = spaceId
    this.db = null
  }

  /** Something to send was saved or deleted: the sync by itself is told (unless this database is quiet) */
  #changed(): void {
    if (!this.quiet) noteLocalChange()
  }

  /** A transaction on some stores; the database must have been opened with init() */
  #transaction(stores: string[], mode: IDBTransactionMode): IDBTransaction {
    if (!this.db) throw new Error('ChordlessDB is not initialised: call init() first')
    return this.db.transaction(stores, mode)
  }

  async init(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION)

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'))
      }

      // Another window on a newer build wants to upgrade: let go, or its open waits for ever
      /* v8 ignore start -- needs a second window on an older build holding the database open */
      request.onblocked = () => {
        void import('./toast.ts').then(({ toast }) =>
          toast('Close the other Chordless windows to finish updating.', { kind: 'error' })
        )
      }
      /* v8 ignore stop */

      request.onsuccess = () => {
        this.db = request.result
        this.db.onversionchange = () => this.db?.close()
        resolve()
        ensurePersistentStorage(this.spaceId)
      }

      request.onupgradeneeded = event => {
        const db = request.result
        const oldVersion = event.oldVersion

        // Create Songs store (moved from global SongsDB)
        // Now uses uuid as keyPath instead of id
        if (!db.objectStoreNames.contains('songs')) {
          const songStore = db.createObjectStore('songs', { keyPath: 'uuid' })
          songStore.createIndex('id', 'id', { unique: false })
          songStore.createIndex('ccliNumber', 'ccliNumber', { unique: false })
          songStore.createIndex('titleNormalized', 'titleNormalized', { unique: false })
          songStore.createIndex('isDefault', 'isDefault', { unique: false })
          songStore.createIndex('importDate', 'importDate', { unique: false })
        }

        // Create ChordPro store (moved from global ChordProDB)
        if (!db.objectStoreNames.contains('chordpro')) {
          const chordproStore = db.createObjectStore('chordpro', { keyPath: 'id' })
          chordproStore.createIndex('contentHash', 'contentHash', { unique: false })
        }

        // Create/Update Setlists store
        if (!db.objectStoreNames.contains('setlists')) {
          const setlistStore = db.createObjectStore('setlists', { keyPath: 'id' })
          setlistStore.createIndex('date', 'date', { unique: false })
          setlistStore.createIndex('type', 'type', { unique: false })
          setlistStore.createIndex('owner', 'owner', { unique: false })
        } else {
          // Add owner index if upgrading from old version
          const setlistStore = (request.transaction as IDBTransaction).objectStore('setlists')
          if (!setlistStore.indexNames.contains('owner')) {
            setlistStore.createIndex('owner', 'owner', { unique: false })
          }
        }

        // Create setlist_local store (new in v5)
        if (!db.objectStoreNames.contains('setlist_local')) {
          db.createObjectStore('setlist_local', { keyPath: 'setlistId' })
        }

        // Files whose records were deleted here and are to go in the Drive trash (new in v9)
        if (!db.objectStoreNames.contains('pending_deletions')) {
          db.createObjectStore('pending_deletions', { keyPath: 'ref' })
        }

        if (oldVersion > 0 && oldVersion < DB_VERSION) {
          migrateRecords(request.transaction as IDBTransaction, oldVersion)
        }

        // Clean up old stores
        if (db.objectStoreNames.contains('song_usage')) {
          db.deleteObjectStore('song_usage')
        }
      }
    })
  }

  // Setlist operations
  /** Save a setlist (its songs' tempos as numbers); resolves with what was stored */
  async saveSetlist(setlist: Setlist): Promise<Setlist> {
    const tx = this.#transaction(['setlists'], 'readwrite')
    const store = tx.objectStore('setlists')
    const stored = cloneForStorage(withNumericTempos(setlist)) as Setlist
    store.put(stored)
    const result = await transactionDone(tx, stored)
    this.#changed()
    return result
  }

  /**
   * Batch save multiple setlists in one transaction (faster)
   */
  async saveSetlistsBatch(setlists: Setlist[]): Promise<void> {
    if (setlists.length === 0) return

    const tx = this.#transaction(['setlists'], 'readwrite')
    const store = tx.objectStore('setlists')

    // Queue all puts in one transaction
    for (const setlist of setlists) {
      store.put(cloneForStorage(withNumericTempos(setlist)))
    }

    return transactionDone(tx)
  }

  async getSetlist(id: string): Promise<Setlist | undefined> {
    const tx = this.#transaction(['setlists'], 'readonly')
    const store = tx.objectStore('setlists')
    const request = store.get(id)
    return requestResult(request)
  }

  async getAllSetlists(): Promise<Setlist[]> {
    const tx = this.#transaction(['setlists'], 'readonly')
    const store = tx.objectStore('setlists')
    const request = store.getAll()
    return requestResult(request)
  }

  async deleteSetlist(id: string): Promise<void> {
    const tx = this.#transaction(['setlists'], 'readwrite')
    const store = tx.objectStore('setlists')
    await store.delete(id)
    await transactionDone(tx)
    this.#changed()
  }

  /**
   * Delete a setlist that is not in Google Drive (it has never been synced), with this
   * device's state for it. A setlist that is in Drive cannot be deleted yet: sync would
   * put it back from either side (see docs/SYNC_ARCHITECTURE.md, "Deleting setlists").
   * @throws if the setlist is in Drive
   */
  async deleteUnsyncedSetlist(id: string): Promise<void> {
    const setlist = await this.getSetlist(id)
    if (!setlist) return
    if (setlist.fileRef) {
      throw new Error('This setlist is in Google Drive, so it cannot be deleted here')
    }
    await this.deleteSetlist(id)
    await this.deleteLocalState(id)
  }

  // Song operations (per-space)
  /** Save a song (its tempos as numbers); resolves with what was stored */
  async saveSong(song: SongInput): Promise<SongRecord> {
    const tx = this.#transaction(['songs'], 'readwrite')
    const store = tx.objectStore('songs')
    const stored = withNumericSongTempos(song)
    store.put(stored)
    const result = await transactionDone(tx, stored)
    this.#changed()
    return result
  }

  async saveSongsBatch(songs: SongInput[]): Promise<void> {
    if (songs.length === 0) return

    const tx = this.#transaction(['songs'], 'readwrite')
    const store = tx.objectStore('songs')

    for (const song of songs) {
      store.put(withNumericSongTempos(song))
    }

    return transactionDone(tx)
  }

  async getSong(uuid: string): Promise<SongRecord | undefined> {
    const tx = this.#transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const request = store.get(uuid)
    return requestResult(request)
  }

  async getAllSongs(): Promise<SongRecord[]> {
    const tx = this.#transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const request = store.getAll()
    return requestResult(request).then(result => result || [])
  }

  async findSongByCCLI(ccliNumber: string): Promise<SongRecord[]> {
    const tx = this.#transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const index = store.index('ccliNumber')
    const request = index.getAll(ccliNumber)
    return requestResult(request).then(result => result || [])
  }

  async findSongByNormalizedTitle(titleNormalized: string): Promise<SongRecord[]> {
    const tx = this.#transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const index = store.index('titleNormalized')
    const request = index.getAll(titleNormalized)
    return requestResult(request).then(result => result || [])
  }

  async getSongVariants(songId: string): Promise<SongRecord[]> {
    const tx = this.#transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const index = store.index('id')
    const request = index.getAll(songId)
    return requestResult(request).then(result => result || [])
  }

  async getDefaultSongVariant(songId: string): Promise<SongRecord | null> {
    const variants = await this.getSongVariants(songId)
    return variants.find(v => v.isDefault) || variants[0] || null
  }

  // ChordPro operations (per-space)
  async saveChordPro(chordpro: ChordProRecord): Promise<void> {
    const tx = this.#transaction(['chordpro'], 'readwrite')
    const store = tx.objectStore('chordpro')
    await store.put(chordpro)
    await transactionDone(tx)
    this.#changed()
  }

  async getChordPro(id: string): Promise<ChordProRecord | undefined> {
    const tx = this.#transaction(['chordpro'], 'readonly')
    const store = tx.objectStore('chordpro')
    const request = store.get(id)
    return requestResult(request)
  }

  // Local state operations (per-setlist, per-user)
  async getLocalState(setlistId: string): Promise<SetlistLocalState> {
    const tx = this.#transaction(['setlist_local'], 'readonly')
    const store = tx.objectStore('setlist_local')
    const request = store.get(setlistId)
    // Defaults if not found
    return requestResult(request).then(
      result =>
        result || {
          setlistId,
          padsEnabled: false,
          padSound: null,
          clickEnabled: false,
          sectionVisibility: {},
          lastUsedDate: new Date().toISOString(),
        }
    )
  }

  async saveLocalState(localState: SetlistLocalState): Promise<void> {
    const tx = this.#transaction(['setlist_local'], 'readwrite')
    const store = tx.objectStore('setlist_local')
    await store.put(localState)
    return transactionDone(tx)
  }

  async deleteLocalState(setlistId: string): Promise<void> {
    const tx = this.#transaction(['setlist_local'], 'readwrite')
    const store = tx.objectStore('setlist_local')
    await store.delete(setlistId)
    return transactionDone(tx)
  }

  // Song Usage operations (workspace-specific)
  async getSongUsageFromSetlists(songId: string): Promise<SongUsage[]> {
    if (!songId) return []

    const tx = this.#transaction(['setlists'], 'readonly')
    const store = tx.objectStore('setlists')
    const request = store.getAll()

    const setlists: Setlist[] = await requestResult(request)
    const appearances: SongUsage[] = []
    for (const setlist of setlists) {
      if (!Array.isArray(setlist.songs)) continue

      setlist.songs.forEach((song, index) => {
        if (song.songId !== songId) return

        appearances.push({
          setlistId: setlist.id,
          setlistDate: setlist.date,
          setlistName: setlist.name,
          leader: setlist.owner,
          type: setlist.type,
          playedInKey: song.key,
          order: index,
        })
      })
    }

    return appearances.sort((a, b) => (b.setlistDate || '').localeCompare(a.setlistDate || ''))
  }

  // Clear setlists, songs and charts, keeping per-setlist device state
  // (setlist_local). Used to reset from Drive.
  async clearSyncedData(): Promise<void> {
    const tx = this.#transaction(['setlists', 'songs', 'chordpro'], 'readwrite')
    for (const name of ['setlists', 'songs', 'chordpro']) {
      tx.objectStore(name).clear()
    }
    return transactionDone(tx)
  }

  /**
   * Forget every link to Drive: each setlist and song is left as a new one that Drive has never
   * seen, so the next sync uploads it all. Content stays; a setlist's share link goes, since
   * its file was in the folder that is let go. Used to start over in a new Drive folder.
   */
  async clearFileLinks(): Promise<void> {
    const tx = this.#transaction(['setlists', 'songs'], 'readwrite')
    const unlinked = {
      fileRef: null,
      fileModified: null,
      fileRev: null,
      lastSyncedAt: null,
      syncedContentHash: null,
    }
    const setlists = tx.objectStore('setlists')
    const songs = tx.objectStore('songs')
    const setlistsRequest = setlists.getAll()
    const songsRequest = songs.getAll()
    setlistsRequest.onsuccess = () => {
      for (const setlist of setlistsRequest.result as Setlist[]) {
        setlists.put({ ...setlist, ...unlinked, _lastSyncHash: null, share: null })
      }
    }
    songsRequest.onsuccess = () => {
      for (const song of songsRequest.result as SongRecord[]) {
        songs.put({ ...song, ...unlinked, fileProps: null })
      }
    }
    return transactionDone(tx)
  }

  /**
   * Let go of the files with these refs, keeping the setlists and songs: each is as one that was
   * never uploaded, so the next push makes a new file. For records kept although their file is
   * gone (they were edited here), by a sync that is told of a file once and cannot list the rest.
   * @returns how many records were let go
   */
  async unlinkFiles(refs: Set<string>): Promise<number> {
    const tx = this.#transaction(['setlists', 'songs'], 'readwrite')
    const unlinked = {
      fileRef: null,
      fileModified: null,
      fileRev: null,
      lastSyncedAt: null,
      syncedContentHash: null,
    }
    let count = 0
    const setlists = tx.objectStore('setlists')
    const songs = tx.objectStore('songs')
    const setlistsRequest = setlists.getAll()
    const songsRequest = songs.getAll()
    setlistsRequest.onsuccess = () => {
      for (const setlist of setlistsRequest.result as Setlist[]) {
        if (!setlist.fileRef || !refs.has(setlist.fileRef)) continue
        setlists.put({ ...setlist, ...unlinked, _lastSyncHash: null })
        count++
      }
    }
    songsRequest.onsuccess = () => {
      for (const song of songsRequest.result as SongRecord[]) {
        if (!song.fileRef || !refs.has(song.fileRef)) continue
        songs.put({ ...song, ...unlinked, fileProps: null })
        count++
      }
    }
    await transactionDone(tx)
    return count
  }

  /**
   * Delete a song and its chart. If it has a file in Drive, that is noted, for the next sync to
   * put in the Drive trash: without that, the file would bring the song back. A song deleted
   * because Drive no longer has its file passes `remember: false`.
   */
  async deleteSong(uuid: string, { remember = true }: { remember?: boolean } = {}): Promise<void> {
    const song = await this.getSong(uuid)
    if (!song) return
    const tx = this.#transaction(['songs', 'chordpro', 'pending_deletions'], 'readwrite')
    tx.objectStore('songs').delete(uuid)
    if (remember && song.fileRef) {
      const pending: PendingDeletion = {
        ref: song.fileRef,
        kind: 'song',
        deletedAt: new Date().toISOString(),
      }
      tx.objectStore('pending_deletions').put(pending)
    }
    await transactionDone(tx)
    // The chart goes too, unless another song uses it
    const shared = (await this.getAllSongs()).some(
      other => other.chordproFileId === song.chordproFileId
    )
    if (song.chordproFileId && !shared) {
      const tx2 = this.#transaction(['chordpro'], 'readwrite')
      tx2.objectStore('chordpro').delete(song.chordproFileId)
      await transactionDone(tx2)
    }
    this.#changed()
  }

  /** The files to be put in the Drive trash at the next sync */
  async getPendingDeletions(): Promise<PendingDeletion[]> {
    const tx = this.#transaction(['pending_deletions'], 'readonly')
    return requestResult(tx.objectStore('pending_deletions').getAll())
  }

  /** Note that a file has been put in the trash (or is gone): it is no longer to be */
  async clearPendingDeletion(ref: string): Promise<void> {
    const tx = this.#transaction(['pending_deletions'], 'readwrite')
    tx.objectStore('pending_deletions').delete(ref)
    return transactionDone(tx)
  }

  // Clear all data (for re-import)
  async clearAll(): Promise<void> {
    const tx = this.#transaction(
      ['setlists', 'songs', 'chordpro', 'setlist_local', 'pending_deletions'],
      'readwrite'
    )

    const setlistStore = tx.objectStore('setlists')
    const songStore = tx.objectStore('songs')
    const chordproStore = tx.objectStore('chordpro')
    const localStore = tx.objectStore('setlist_local')
    tx.objectStore('pending_deletions').clear()

    await setlistStore.clear()
    await songStore.clear()
    await chordproStore.clear()
    await localStore.clear()

    return transactionDone(tx)
  }
}

// Utility functions
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, '') // Remove all whitespace
    .trim()
}

/**
 * Parse tempo string into BPM number and note subdivision
 * Examples:
 *   "150" -> { bpm: 150, note: "1/4" }
 *   "61 bpm" -> { bpm: 61, note: "1/4" }
 *   "150 (1/8)" -> { bpm: 150, note: "1/8" }
 *   "150 (8th note)" -> { bpm: 150, note: "1/8" }
 *
 * @param tempoStr - Tempo string from ChordPro metadata
 * @returns Parsed tempo and note subdivision
 */
export function parseTempo(tempoStr: TempoInput): { bpm: number | null; note: string } {
  if (!tempoStr) {
    return { bpm: null, note: '1/4' }
  }

  const str = String(tempoStr).trim()

  // Extract base BPM number (first number in the string)
  const bpmMatch = str.match(/(\d+)/)
  const bpm = bpmMatch ? parseInt(bpmMatch[1], 10) : null

  // Extract note subdivision from brackets or text
  let note = '1/4' // Default to quarter note

  // Check for bracketed subdivision like (1/8) or (8th note)
  const bracketMatch = str.match(/\(([^)]+)\)/)
  if (bracketMatch) {
    const bracketContent = bracketMatch[1].trim().toLowerCase()

    // Check for fraction format like "1/8"
    if (bracketContent.match(/1\/\d+/)) {
      note = bracketContent
    }
    // Check for written format like "8th note" or "16th"
    else if (bracketContent.includes('8th') || bracketContent.includes('eighth')) {
      note = '1/8'
    } else if (bracketContent.includes('16th') || bracketContent.includes('sixteenth')) {
      note = '1/16'
    } else if (bracketContent.includes('half')) {
      note = '1/2'
    } else if (bracketContent.includes('whole')) {
      note = '1/1'
    }
  }

  return { bpm, note }
}

/** A tempo (number, or a chart's text such as '72' or '150 (1/8)') as a number of BPM, or null */
function tempoBpm(tempo: TempoInput): number | null {
  return parseTempo(tempo).bpm
}

/**
 * Tempos are stored as numbers of BPM. The save methods below convert them, so
 * whatever a caller passes (a chart's text, from an import, Drive or an older
 * record), what's stored is a number or null.
 */
function numericTempo(tempo: TempoInput): number | null | undefined {
  if (typeof tempo === 'number') return tempo
  return tempo == null ? (tempo as null | undefined) : tempoBpm(tempo)
}

/** The song with its tempo and original tempo as numbers */
function withNumericSongTempos(song: SongInput): SongRecord {
  const tempo = numericTempo(song.tempo)
  const originalTempo = numericTempo(song.originalTempo)
  if (tempo === song.tempo && originalTempo === song.originalTempo) return song as SongRecord
  return { ...song, tempo: tempo ?? null, originalTempo: originalTempo ?? null }
}

/** The setlist with each song's tempo a number (older setlists may hold a chart's text) */
export function withNumericTempos<T extends { songs?: { tempo?: TempoInput }[] }>(setlist: T): T {
  if (!Array.isArray(setlist?.songs)) return setlist
  return {
    ...setlist,
    songs: setlist.songs.map(entry =>
      entry.tempo === numericTempo(entry.tempo)
        ? entry
        : { ...entry, tempo: numericTempo(entry.tempo) }
    ),
  }
}

/**
 * Version 6: songs' and setlist entries' tempos become numbers (they were a
 * chart's text). A setlist that was in sync stays in sync: its synced hash is
 * refreshed for the converted content.
 */
/**
 * What a record kept of its file in the storage was called before 2026-10-20 (when sync stopped
 * being about Google Drive alone): the file's ref, its rev, when it changed, and the properties
 * the song's file had when it was last synced.
 */
const FILE_FIELDS_BEFORE_V7: Record<string, string> = {
  driveFileId: 'fileRef',
  driveChecksum: 'fileRev',
  driveModifiedTime: 'fileModified',
  driveProperties: 'fileProps',
}

/** The record with those fields under their new names (the new name wins if both are there) */
export function withFileFieldsRenamed<T extends object>(record: T): T {
  const renamed = { ...record } as Record<string, unknown>
  let changed = false
  for (const [before, now] of Object.entries(FILE_FIELDS_BEFORE_V7)) {
    if (!(before in renamed)) continue
    if (!(now in renamed)) renamed[now] = renamed[before]
    delete renamed[before]
    changed = true
  }
  return changed ? (renamed as T) : record
}

/**
 * The song with an empty source where it was recorded as how it arrived (Google Drive, a copy,
 * an import) and not where it came from (docs/SPACES.md; `song-source.ts`). The true origin of
 * such a song is not known, so it is not guessed.
 */
export function withOriginKept<T extends { importSource?: string }>(song: T): T {
  if (song.importSource === undefined) return song
  const source = songSource(song.importSource)
  return source === song.importSource ? song : { ...song, importSource: source }
}

/**
 * Bring the songs and setlists of a database from `oldVersion` up to date: tempos as numbers
 * (version 6), the file fields under their new names (7), and the source of a song kept as where it
 * came from, not how it arrived (8). One pass over each store applies every
 * step to a record in turn: a cursor for each step would each read the record as it was, and the
 * last to write would undo the others.
 */
function migrateRecords(transaction: IDBTransaction, oldVersion: number) {
  const songs = transaction.objectStore('songs').openCursor()
  songs.onsuccess = () => {
    const cursor = songs.result
    if (!cursor) return
    let song = cursor.value
    if (oldVersion < 6) song = withNumericSongTempos(song)
    if (oldVersion < 7) song = withFileFieldsRenamed(song)
    if (oldVersion < 8) song = withOriginKept(song)
    if (song !== cursor.value) cursor.update(song)
    cursor.continue()
  }
  const setlists = transaction.objectStore('setlists').openCursor()
  setlists.onsuccess = () => {
    const cursor = setlists.result
    if (!cursor) return
    const before: Setlist = cursor.value
    let setlist = before
    if (oldVersion < 6) {
      const converted = withNumericTempos(setlist)
      if (JSON.stringify(converted) !== JSON.stringify(setlist)) {
        if (
          setlist.syncedContentHash &&
          setlist.syncedContentHash === setlistContentHash(setlist)
        ) {
          converted.syncedContentHash = setlistContentHash(converted)
        }
        setlist = converted
      }
    }
    if (oldVersion < 7) setlist = withFileFieldsRenamed(setlist)
    if (setlist !== before) cursor.update(setlist)
    cursor.continue()
  }
}

/**
 * Helper to get current space database
 * Returns a database instance for the currently active space
 */
export async function getCurrentDB(): Promise<ChordlessDB> {
  const { ensureCurrentSpace } = await import('./space.ts')
  const { id } = await ensureCurrentSpace()
  return openSpace(id)
}

/** The database of a space, which need not be the current one (an import may go to another) */
export async function openSpace(spaceId: string): Promise<ChordlessDB> {
  const db = new ChordlessDB(spaceId)
  await db.init()
  return db
}

// Setlist utility functions

/**
 * Get the next Sunday from today
 */
export function getNextSunday(): Date {
  const today = new Date()
  const dayOfWeek = today.getDay()
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek
  const nextSunday = new Date(today)
  nextSunday.setDate(today.getDate() + daysUntilSunday)
  nextSunday.setHours(0, 0, 0, 0)
  return nextSunday
}

/**
 * Determine setlist type based on date and name
 */
export function determineSetlistType(dateString: string, name?: string | null): string {
  const date = parseLocalDate(dateString)
  const dayOfWeek = date.getDay()

  // If there's a name, default to Event
  if (name?.trim()) {
    return SETLIST_TYPES.EVENT
  }

  // Sunday = Church Service
  if (dayOfWeek === 0) {
    return SETLIST_TYPES.CHURCH_SERVICE
  }

  // Tuesday or Wednesday = Prayer Meeting
  if (dayOfWeek === 2 || dayOfWeek === 3) {
    return SETLIST_TYPES.PRAYER_MEETING
  }

  // Default to Event for other days
  return SETLIST_TYPES.EVENT
}

/**
 * Create a new setlist object with defaults
 */
export function createSetlist({
  date,
  time,
  type,
  name,
  owner,
  ownerId,
  createdBy,
}: {
  date?: string | Date
  time?: string
  type?: string
  name?: string
  owner?: string
  ownerId?: string
  /** Who made it (see Setlist.createdBy) */
  createdBy?: string
} = {}): Setlist {
  const setlistDate = date || getNextSunday()
  const dateString = typeof setlistDate === 'string' ? setlistDate : toLocalDateString(setlistDate)

  return {
    id: crypto.randomUUID(),
    date: dateString,
    time: time || '10:30',
    type: type || determineSetlistType(dateString, name),
    name: name || '',
    owner: owner || '',
    // Leader's Google account email (empty for a leader known only by name)
    ownerId: ownerId || '',
    ...(createdBy ? { createdBy } : {}),
    songs: [],
    createdDate: new Date().toISOString(),
    modifiedDate: new Date().toISOString(),
  }
}
