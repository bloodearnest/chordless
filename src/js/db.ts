import type {
  ChordProRecord,
  ParsedChart,
  Setlist,
  SetlistLocalState,
  SongInput,
  SongRecord,
  TempoInput,
} from './data-types.ts'
import { setlistContentHash } from './sync/setlist-hash.ts'
import { parseLocalDate, toLocalDateString } from './utils/date-utils.ts'
import { transactionError } from './utils/idb.ts'
import { ensurePersistentStorage } from './utils/persistence.ts'

// IndexedDB wrapper for database operations
// Manages organisation-specific data: songs, chordpro content, setlists, and local state
//
// NOTE: This now stores ALL organisation data in one database per organisation.
// Organisation metadata is stored separately in the 'organisations' database.

const DB_VERSION = 6

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

  // Anything else (e.g., BigInt) -> convert to string
  if (type === 'bigint') {
    return value.toString()
  }

  return value
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

/** A setlist from before the current schema (see migrateSetlist) */
interface LegacySetlist extends Partial<Omit<Setlist, 'songs'>> {
  id: string
  date: string
  leader?: string
  createdAt?: string
  updatedAt?: string
  songs?: {
    order?: number
    songId: string
    songUuid?: string
    key?: string | null
    tempo?: TempoInput
    notes?: string
    modifications?: { targetKey?: string; bpmOverride?: TempoInput }
  }[]
}

export class ChordlessDB {
  dbName: string
  organisationId: string
  db: IDBDatabase | null

  constructor(organisationId: string) {
    if (!organisationId) {
      throw new Error('organisationId is required for ChordlessDB')
    }

    // Database name is just the organisation ID
    // This allows renaming organisations without database migration
    this.dbName = organisationId
    this.organisationId = organisationId
    this.db = null
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

      request.onsuccess = () => {
        this.db = request.result
        resolve()
        ensurePersistentStorage(this.organisationId)
      }

      request.onupgradeneeded = event => {
        const db = request.result
        const oldVersion = event.oldVersion

        console.log(`[ChordlessDB] Upgrading ${this.dbName} from v${oldVersion} to v${DB_VERSION}`)

        // Create Songs store (moved from global SongsDB)
        // Now uses uuid as keyPath instead of id
        if (!db.objectStoreNames.contains('songs')) {
          console.log('[ChordlessDB] Creating songs store')
          const songStore = db.createObjectStore('songs', { keyPath: 'uuid' })
          songStore.createIndex('id', 'id', { unique: false })
          songStore.createIndex('ccliNumber', 'ccliNumber', { unique: false })
          songStore.createIndex('titleNormalized', 'titleNormalized', { unique: false })
          songStore.createIndex('isDefault', 'isDefault', { unique: false })
          songStore.createIndex('importDate', 'importDate', { unique: false })
        }

        // Create ChordPro store (moved from global ChordProDB)
        if (!db.objectStoreNames.contains('chordpro')) {
          console.log('[ChordlessDB] Creating chordpro store')
          const chordproStore = db.createObjectStore('chordpro', { keyPath: 'id' })
          chordproStore.createIndex('contentHash', 'contentHash', { unique: false })
        }

        // Create/Update Setlists store
        if (!db.objectStoreNames.contains('setlists')) {
          console.log('[ChordlessDB] Creating setlists store')
          const setlistStore = db.createObjectStore('setlists', { keyPath: 'id' })
          setlistStore.createIndex('date', 'date', { unique: false })
          setlistStore.createIndex('type', 'type', { unique: false })
          setlistStore.createIndex('owner', 'owner', { unique: false })
        } else {
          // Add owner index if upgrading from old version
          const transaction = request.transaction
          if (!transaction) throw new Error('No upgrade transaction')
          const setlistStore = transaction.objectStore('setlists')
          if (!setlistStore.indexNames.contains('owner')) {
            console.log('[ChordlessDB] Adding owner index to setlists')
            setlistStore.createIndex('owner', 'owner', { unique: false })
          }
        }

        // Create setlist_local store (new in v5)
        if (!db.objectStoreNames.contains('setlist_local')) {
          console.log('[ChordlessDB] Creating setlist_local store')
          db.createObjectStore('setlist_local', { keyPath: 'setlistId' })
        }

        if (oldVersion > 0 && oldVersion < 6 && request.transaction) {
          migrateTemposToNumbers(request.transaction)
        }

        // Clean up old stores
        if (db.objectStoreNames.contains('song_usage')) {
          console.log('[ChordlessDB] Removing song_usage store')
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
    return new Promise<Setlist>((resolve, reject) => {
      tx.oncomplete = () => resolve(stored)
      tx.onerror = event => reject(transactionError(event, tx))
    })
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

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }

  async getSetlist(id: string): Promise<Setlist | undefined> {
    const tx = this.#transaction(['setlists'], 'readonly')
    const store = tx.objectStore('setlists')
    const request = store.get(id)
    return new Promise<Setlist | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async getAllSetlists(): Promise<Setlist[]> {
    const tx = this.#transaction(['setlists'], 'readonly')
    const store = tx.objectStore('setlists')
    const request = store.getAll()
    return new Promise<Setlist[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async deleteSetlist(id: string): Promise<void> {
    const tx = this.#transaction(['setlists'], 'readwrite')
    const store = tx.objectStore('setlists')
    await store.delete(id)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = event => reject(transactionError(event, tx))
    })
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
    if (setlist.driveFileId) {
      throw new Error('This setlist is in Google Drive, so it cannot be deleted here')
    }
    await this.deleteSetlist(id)
    await this.deleteLocalState(id)
  }

  // Song operations (per-organisation)
  /** Save a song (its tempos as numbers); resolves with what was stored */
  async saveSong(song: SongInput): Promise<SongRecord> {
    const tx = this.#transaction(['songs'], 'readwrite')
    const store = tx.objectStore('songs')
    const stored = withNumericSongTempos(song)
    store.put(stored)
    return new Promise<SongRecord>((resolve, reject) => {
      tx.oncomplete = () => resolve(stored)
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }

  async saveSongsBatch(songs: SongInput[]): Promise<void> {
    if (songs.length === 0) return

    const tx = this.#transaction(['songs'], 'readwrite')
    const store = tx.objectStore('songs')

    for (const song of songs) {
      store.put(withNumericSongTempos(song))
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }

  async getSong(uuid: string): Promise<SongRecord | undefined> {
    const tx = this.#transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const request = store.get(uuid)
    return new Promise<SongRecord | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async getAllSongs(): Promise<SongRecord[]> {
    const tx = this.#transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const request = store.getAll()
    return new Promise<SongRecord[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  async findSongByCCLI(ccliNumber: string): Promise<SongRecord[]> {
    const tx = this.#transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const index = store.index('ccliNumber')
    const request = index.getAll(ccliNumber)
    return new Promise<SongRecord[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  async findSongByNormalizedTitle(titleNormalized: string): Promise<SongRecord[]> {
    const tx = this.#transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const index = store.index('titleNormalized')
    const request = index.getAll(titleNormalized)
    return new Promise<SongRecord[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  async getSongVariants(songId: string): Promise<SongRecord[]> {
    const tx = this.#transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const index = store.index('id')
    const request = index.getAll(songId)
    return new Promise<SongRecord[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  async getDefaultSongVariant(songId: string): Promise<SongRecord | null> {
    const variants = await this.getSongVariants(songId)
    return variants.find(v => v.isDefault) || variants[0] || null
  }

  async deleteSong(uuid: string): Promise<void> {
    const tx = this.#transaction(['songs'], 'readwrite')
    const store = tx.objectStore('songs')
    await store.delete(uuid)
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }

  // ChordPro operations (per-organisation)
  async saveChordPro(chordpro: ChordProRecord): Promise<void> {
    const tx = this.#transaction(['chordpro'], 'readwrite')
    const store = tx.objectStore('chordpro')
    await store.put(chordpro)
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }

  async getChordPro(id: string): Promise<ChordProRecord | undefined> {
    const tx = this.#transaction(['chordpro'], 'readonly')
    const store = tx.objectStore('chordpro')
    const request = store.get(id)
    return new Promise<ChordProRecord | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async deleteChordPro(id: string): Promise<void> {
    const tx = this.#transaction(['chordpro'], 'readwrite')
    const store = tx.objectStore('chordpro')
    await store.delete(id)
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }

  async findChordProByContentHash(contentHash: string): Promise<ChordProRecord | undefined> {
    const tx = this.#transaction(['chordpro'], 'readonly')
    const store = tx.objectStore('chordpro')
    const index = store.index('contentHash')
    const request = index.get(contentHash)
    return new Promise<ChordProRecord | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  // Local state operations (per-setlist, per-user)
  async getLocalState(setlistId: string): Promise<SetlistLocalState> {
    const tx = this.#transaction(['setlist_local'], 'readonly')
    const store = tx.objectStore('setlist_local')
    const request = store.get(setlistId)
    return new Promise<SetlistLocalState>((resolve, reject) => {
      request.onsuccess = () => {
        // Return defaults if not found
        resolve(
          request.result || {
            setlistId,
            padsEnabled: false,
            padSound: null,
            clickEnabled: false,
            sectionVisibility: {},
            lastUsedDate: new Date().toISOString(),
          }
        )
      }
      request.onerror = () => reject(request.error)
    })
  }

  async saveLocalState(localState: SetlistLocalState): Promise<void> {
    const tx = this.#transaction(['setlist_local'], 'readwrite')
    const store = tx.objectStore('setlist_local')
    await store.put(localState)
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }

  async updateLastUsed(setlistId: string): Promise<void> {
    const state = await this.getLocalState(setlistId)
    state.lastUsedDate = new Date().toISOString()
    return this.saveLocalState(state)
  }

  async deleteLocalState(setlistId: string): Promise<void> {
    const tx = this.#transaction(['setlist_local'], 'readwrite')
    const store = tx.objectStore('setlist_local')
    await store.delete(setlistId)
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }

  // Song Usage operations (workspace-specific)
  async getSongUsageFromSetlists(songId: string): Promise<SongUsage[]> {
    if (!songId) return []

    const tx = this.#transaction(['setlists'], 'readonly')
    const store = tx.objectStore('setlists')
    const request = store.getAll()

    return new Promise<SongUsage[]>((resolve, reject) => {
      request.onsuccess = () => {
        const setlists: Setlist[] = request.result || []
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

        appearances.sort((a, b) => (b.setlistDate || '').localeCompare(a.setlistDate || ''))
        resolve(appearances)
      }
      request.onerror = () => reject(request.error)
    })
  }

  // Migrate a setlist from old schema to new schema
  migrateSetlist(oldSetlist: LegacySetlist): Setlist {
    // Generate UUID if setlist has date-based ID
    const needsNewId = /^\d{4}-\d{2}-\d{2}/.test(oldSetlist.id)

    const newSetlist: Setlist = {
      id: needsNewId ? crypto.randomUUID() : oldSetlist.id,
      date: oldSetlist.date,
      time: oldSetlist.time || '10:30',
      type: oldSetlist.type || 'Church Service',
      name: oldSetlist.name || '',
      owner: oldSetlist.owner || oldSetlist.leader || '', // Rename leader → owner
      songs: (oldSetlist.songs || []).map(song => ({
        order: song.order ?? 0,
        songId: song.songId,
        songUuid: song.songUuid || song.songId, // Use songId as fallback if songUuid missing
        key: song.key !== undefined ? song.key : song.modifications?.targetKey || null,
        tempo: tempoBpm(song.tempo !== undefined ? song.tempo : song.modifications?.bpmOverride),
        notes: song.notes || '',
      })),
      createdDate: oldSetlist.createdDate || oldSetlist.createdAt || new Date().toISOString(),
      modifiedDate: oldSetlist.modifiedDate || oldSetlist.updatedAt || new Date().toISOString(),
      driveFileId: oldSetlist.driveFileId || null,
      driveModifiedTime: oldSetlist.driveModifiedTime || null,
      lastSyncedAt: oldSetlist.lastSyncedAt || null,
      _lastSyncHash: oldSetlist._lastSyncHash || null,
    }

    return newSetlist
  }

  // Migrate all setlists in database to new schema
  async migrateAllSetlists(): Promise<number> {
    // Old records may still have the old schema's fields
    const allSetlists = (await this.getAllSetlists()) as LegacySetlist[]
    let migratedCount = 0

    for (const setlist of allSetlists) {
      // Check if setlist needs migration
      const needsMigration =
        setlist.leader !== undefined ||
        setlist.createdAt !== undefined ||
        setlist.updatedAt !== undefined ||
        setlist.songs?.some(s => s.modifications !== undefined)

      if (needsMigration) {
        const migrated = this.migrateSetlist(setlist)

        // If ID changed, delete old one and save new one
        if (migrated.id !== setlist.id) {
          await this.deleteSetlist(setlist.id)
        }

        await this.saveSetlist(migrated)
        migratedCount++
        console.log(
          `[Migration] Migrated setlist: ${setlist.date} (${setlist.id} → ${migrated.id})`
        )
      }
    }

    console.log(`[Migration] Migrated ${migratedCount} setlists`)
    return migratedCount
  }

  // Clear setlists, songs and charts, keeping per-setlist device state
  // (setlist_local). Used to reset from Drive.
  async clearSyncedData(): Promise<void> {
    const tx = this.#transaction(['setlists', 'songs', 'chordpro'], 'readwrite')
    for (const name of ['setlists', 'songs', 'chordpro']) {
      tx.objectStore(name).clear()
    }
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }

  // Clear all data (for re-import)
  async clearAll(): Promise<void> {
    const tx = this.#transaction(['setlists', 'songs', 'chordpro', 'setlist_local'], 'readwrite')

    const setlistStore = tx.objectStore('setlists')
    const songStore = tx.objectStore('songs')
    const chordproStore = tx.objectStore('chordpro')
    const localStore = tx.objectStore('setlist_local')

    await setlistStore.clear()
    await songStore.clear()
    await chordproStore.clear()
    await localStore.clear()

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = event => reject(transactionError(event, tx))
    })
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

export function hashText(text: string): string {
  // Simple hash for conflict detection
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(36)
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
export function tempoBpm(tempo: TempoInput): number | null {
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
function migrateTemposToNumbers(transaction: IDBTransaction) {
  const songs = transaction.objectStore('songs').openCursor()
  songs.onsuccess = () => {
    const cursor = songs.result
    if (!cursor) return
    const converted = withNumericSongTempos(cursor.value)
    if (converted !== cursor.value) cursor.update(converted)
    cursor.continue()
  }
  const setlists = transaction.objectStore('setlists').openCursor()
  setlists.onsuccess = () => {
    const cursor = setlists.result
    if (!cursor) return
    const setlist: Setlist = cursor.value
    const converted = withNumericTempos(setlist)
    if (JSON.stringify(converted) !== JSON.stringify(setlist)) {
      if (setlist.syncedContentHash && setlist.syncedContentHash === setlistContentHash(setlist)) {
        converted.syncedContentHash = setlistContentHash(converted)
      }
      cursor.update(converted)
    }
    cursor.continue()
  }
}

/**
 * Format tempo for display as "BPM/note"
 * Examples:
 *   150, "1/4" -> "150"
 *   150, "1/8" -> "150/8"
 *   150, "1/16" -> "150/16"
 *
 * @param bpm - The BPM number
 * @param tempoNote - The note subdivision (e.g., "1/4", "1/8")
 */
export function formatTempo(bpm: number | null | undefined, tempoNote = '1/4'): string {
  if (!bpm) return ''

  // If quarter note (default), just show BPM
  if (!tempoNote || tempoNote === '1/4') {
    return `${bpm}`
  }

  // Otherwise show BPM/denominator (e.g., "150/8" for 1/8 notes)
  const [, denominator] = tempoNote.split('/').map(Number)
  if (denominator) {
    return `${bpm}/${denominator}`
  }

  return `${bpm}`
}

/**
 * Helper to get current organisation database
 * Returns a database instance for the currently active organisation
 */
export async function getCurrentDB(): Promise<ChordlessDB> {
  const { ensureCurrentOrganisation } = await import('./organisation.ts')
  const { id } = await ensureCurrentOrganisation()
  const db = new ChordlessDB(id)
  await db.init()
  return db
}

export function generateSongId(parsed: ParsedChart): string {
  // Prefer CCLI number as deterministic ID
  if (parsed.metadata.ccliSongNumber || parsed.metadata.ccli) {
    const ccli = parsed.metadata.ccliSongNumber || parsed.metadata.ccli
    return `ccli-${ccli}`
  }
  // Fallback to normalized title
  if (parsed.metadata.title) {
    return `title-${normalizeTitle(parsed.metadata.title)}`
  }
  // Last resort: random ID
  return `song-${crypto.randomUUID()}`
}

export function extractLyricsText(parsed: ParsedChart): string {
  // Extract lyrics from parsed structure for search
  const lyrics: string[] = []
  for (const section of parsed.sections) {
    for (const line of section.lines) {
      for (const segment of line.segments) {
        if (segment.lyrics?.trim()) {
          lyrics.push(segment.lyrics.trim())
        }
      }
    }
  }
  return lyrics.join(' ').toLowerCase()
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
}: {
  date?: string | Date
  time?: string
  type?: string
  name?: string
  owner?: string
  ownerId?: string
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
    songs: [],
    createdDate: new Date().toISOString(),
    modifiedDate: new Date().toISOString(),
  }
}
