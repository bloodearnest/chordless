import { announceDataChange, type DataKind, type DataOrigin } from './data-changes.ts'
import type {
  ChordProRecord,
  PendingDeletion,
  Person,
  ScoreRecord,
  Setlist,
  SetlistLocalState,
  SongInput,
  SongRecord,
  TempoInput,
} from './data-types.ts'
import { leaderName } from './leaders.ts'
import { PERSON_SYNC_FIELDS } from './sync/person-hash.ts'
import { setAmbient } from './telemetry/context.ts'
import { recordSpan } from './telemetry/telemetry.ts'
import { parseLocalDate, toLocalDateString } from './utils/date-utils.ts'
import { requestResult, transactionDone } from './utils/idb.ts'
import { ensurePersistentStorage } from './utils/persistence.ts'

// IndexedDB wrapper for database operations
// Manages space-specific data: songs, chordpro content, setlists, and local state
//
// NOTE: This now stores ALL space data in one database per space.
// Space metadata is stored separately in the 'spaces' database.

export const DB_VERSION = 15
/**
 * The oldest version a database is upgraded from (docs/MIGRATIONS.md, "The floor"). Raised when the steps
 * for versions below it are dropped, which is when nobody has a device that old.
 */
export const OLDEST_UPGRADABLE = 14

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
  /** The song, and the version of it that the entry names */
  songId: string
  songUuid: string
  setlistId: string
  setlistDate: string
  setlistName: string
  leader: string
  type: string
  playedInKey: string | null
  order: number
}

/** What the function given to updateSetlist or updateSong returns to leave the record as it is */
export const NO_CHANGE = Symbol('no change')

/** What a setlist keeps of its file in Drive: the link, and what was last synced with it */
const SYNC_LINK_FIELDS = [
  'fileRef',
  'fileModified',
  'fileRev',
  'lastSyncedAt',
  'syncedContentHash',
  '_lastSyncHash',
] as const

/** What a song keeps of its file in Drive, and of what was last sent */
const SONG_LINK_FIELDS = [
  'fileRef',
  'fileModified',
  'fileRev',
  'fileProps',
  'syncedMetadata',
  'lastSyncedAt',
  'syncedContentHash',
] as const

/** The database on this device is of a newer version than this code can read (it cannot be downgraded) */
export class DatabaseNewerError extends Error {
  constructor() {
    super('The data on this device is from a newer version of Chordless than this one can read.')
    this.name = 'DatabaseNewerError'
  }
}

/** The database on this device is older than this code upgrades, and there is no sign-in to make it again from Drive */
export class DatabaseTooOldError extends Error {
  readonly version: number
  constructor(version: number) {
    super('The data on this device is from a version of Chordless that is too old to be upgraded.')
    this.name = 'DatabaseTooOldError'
    this.version = version
  }
}

/** Delete a database (a window that holds it open lets go of it: `onversionchange`) */
function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    /* v8 ignore next -- a browser does not fail to delete a database, short of its storage being gone */
    request.onerror = () => reject(request.error)
  })
}

let toldDatabaseIsNewer = false
let toldDatabaseIsTooOld = false

/** Say, once, that the data is too old to upgrade, that it is untouched, and what makes it again */
async function tellDatabaseIsTooOld(): Promise<void> {
  if (toldDatabaseIsTooOld) return
  toldDatabaseIsTooOld = true
  const { toast } = await import('./toast.ts')
  toast('The data on this device is from an old version of Chordless.', {
    kind: 'error',
    details:
      'It is too old to be upgraded here, and has been left as it is. Sign in with Google to bring your songs and setlists back from Drive.',
  })
}

/** Say that old data was cleared, and that it is being brought back from Drive */
async function tellDatabaseWasCleared(): Promise<void> {
  const { toast } = await import('./toast.ts')
  toast('Chordless is bringing your songs and setlists back from Drive.')
}

/** Say, once, that the data is newer than the app, and offer to look for a newer app (docs/MIGRATIONS.md) */
async function tellDatabaseIsNewer(): Promise<void> {
  if (toldDatabaseIsNewer) return
  toldDatabaseIsNewer = true
  const [{ toast }, { appUpdate }] = await Promise.all([
    import('./toast.ts'),
    import('./app-update.ts'),
  ])
  toast('This device has newer Chordless data than this version can read.', {
    kind: 'error',
    details: `The data is newer than version ${DB_VERSION} of its format. Check for a newer version of the app.`,
    action: { label: 'Check for updates', run: () => void appUpdate.check({ force: true }) },
  })
}

/** Say that another window upgraded the data, so that this one, which let go of it, has to be reloaded */
async function tellDatabaseWasUpgraded(): Promise<void> {
  const [{ toast }, { appUpdate }] = await Promise.all([
    import('./toast.ts'),
    import('./app-update.ts'),
  ])
  toast('Chordless was updated in another window. Reload this one to carry on.', {
    kind: 'error',
    /* v8 ignore next -- reloading the page would end the test run */
    action: { label: 'Reload', run: () => appUpdate.apply() },
  })
}

export class ChordlessDB {
  dbName: string
  spaceId: string
  db: IDBDatabase | null
  /** Who is writing through this handle: a sync's writes are what came from storage, not changes to send */
  readonly origin: DataOrigin

  constructor(spaceId: string, origin: DataOrigin = 'local') {
    if (!spaceId) {
      throw new Error('spaceId is required for ChordlessDB')
    }

    // Database name is just the space ID
    // This allows renaming spaces without database migration
    this.dbName = spaceId
    this.spaceId = spaceId
    this.origin = origin
    this.db = null
  }

  /** A write was committed: whoever shows or sends this data is told (data-changes.ts) */
  #changed(kind: DataKind, ids: string[] | null): void {
    announceDataChange({ spaceId: this.spaceId, kind, ids, origin: this.origin })
  }

  /** Everything of each kind was written or cleared */
  #changedAll(): void {
    for (const kind of ['setlist', 'song', 'chart', 'person', 'score'] as const)
      this.#changed(kind, null)
  }

  /** A transaction on some stores; the database must have been opened with init() */
  #transaction(stores: string[], mode: IDBTransactionMode): IDBTransaction {
    if (!this.db) throw new Error('ChordlessDB is not initialised: call init() first')
    return this.db.transaction(stores, mode)
  }

  /**
   * Open the database, upgrading it. One that is older than `OLDEST_UPGRADABLE` is not upgraded: if
   * there is a sign-in that works with Drive, which has the songs and setlists, it is cleared and
   * made again from there; otherwise it is left as it is, untouched, and `DatabaseTooOldError` says so.
   */
  async init(): Promise<void> {
    try {
      await this.#open()
    } catch (error) {
      if (!(error instanceof DatabaseTooOldError)) throw error
      const { getSignInState } = await import('./google-auth.ts')
      const signIn = await getSignInState()
      if (signIn !== 'signed-in') {
        recordSpan('chordless.db.open', {
          'chordless.db.outcome': 'too_old',
          'chordless.db.old_version': error.version,
          'chordless.db.new_version': DB_VERSION,
          'chordless.db.sign_in': signIn,
        })
        void tellDatabaseIsTooOld()
        throw error
      }
      await deleteDatabase(this.dbName)
      recordSpan('chordless.db.open', {
        'chordless.db.outcome': 'cleared',
        'chordless.db.old_version': error.version,
        'chordless.db.new_version': DB_VERSION,
      })
      void tellDatabaseWasCleared()
      await this.#open()
    }
  }

  #open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const started = performance.now()
      /** The version it was upgraded from, if this open upgraded it (not one made new) */
      let upgradedFrom: number | null = null
      /** The version it is at, if it is older than can be upgraded */
      let tooOld: number | null = null
      const report = (outcome: string, extra: Record<string, string | number | boolean> = {}) =>
        recordSpan('chordless.db.open', {
          'chordless.db.outcome': outcome,
          'chordless.db.new_version': DB_VERSION,
          'chordless.db.open_ms': Math.round(performance.now() - started),
          ...(upgradedFrom === null ? {} : { 'chordless.db.old_version': upgradedFrom }),
          ...extra,
        })
      const request = indexedDB.open(this.dbName, DB_VERSION)

      request.onerror = () => {
        if (tooOld !== null) {
          reject(new DatabaseTooOldError(tooOld))
          return
        }
        const error = request.error
        const name = error?.name ?? 'unknown'
        report('failed', {
          'chordless.error': true,
          'chordless.db.error': name,
          'chordless.db.error_message': error?.message ?? '',
        })
        // The database is of a newer version than this code (a build was rolled back, or an older
        // one is being run): it cannot be read, nor downgraded. Say so, and look for a newer build.
        if (name === 'VersionError') {
          void tellDatabaseIsNewer()
          reject(new DatabaseNewerError())
        } else reject(new Error('Failed to open IndexedDB', { cause: error }))
      }

      // Another window on a newer build wants to upgrade: let go, or its open waits for ever
      /* v8 ignore start -- needs a second window on an older build holding the database open */
      request.onblocked = () => {
        report('blocked')
        void import('./toast.ts').then(({ toast }) =>
          toast('Close the other Chordless windows to finish updating.', { kind: 'error' })
        )
      }
      /* v8 ignore stop */

      request.onsuccess = () => {
        this.db = request.result
        // Another window upgrades it (a newer build): this one lets go, so that its open is not left
        // waiting, and can no longer use the database, which it says (not when it is being deleted)
        this.db.onversionchange = event => {
          this.db?.close()
          if (event.newVersion !== null) void tellDatabaseWasUpgraded()
        }
        setAmbient({ dbVersion: this.db.version })
        if (upgradedFrom !== null) report('upgraded')
        resolve()
        ensurePersistentStorage(this.spaceId)
      }

      request.onupgradeneeded = event => {
        const db = request.result
        const oldVersion = event.oldVersion
        // Older than this build upgrades: leave it as it is (aborting the upgrade changes nothing),
        // and let `init()` decide what is to be done (docs/MIGRATIONS.md, "The floor")
        if (oldVersion > 0 && oldVersion < OLDEST_UPGRADABLE) {
          tooOld = oldVersion
          request.transaction?.abort()
          return
        }
        if (oldVersion > 0) upgradedFrom = oldVersion

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
        }

        // Create setlist_local store (new in v5)
        if (!db.objectStoreNames.contains('setlist_local')) {
          db.createObjectStore('setlist_local', { keyPath: 'setlistId' })
        }

        // Files whose records were deleted here and are to go in the Drive trash (new in v9)
        if (!db.objectStoreNames.contains('pending_deletions')) {
          db.createObjectStore('pending_deletions', { keyPath: 'ref' })
        }

        // The scores of the songs, one for a song that has its lead sheet's MusicXML (new in v13 as
        // `melodies`, renamed in v15)
        if (!db.objectStoreNames.contains('scores')) {
          db.createObjectStore('scores', { keyPath: 'uuid' })
        }

        // The space's people, who lead setlists (new in v10)
        if (!db.objectStoreNames.contains('people')) {
          db.createObjectStore('people', { keyPath: 'id' })
        }

        if (oldVersion > 0 && oldVersion < DB_VERSION) {
          upgradeRecords(request.transaction as IDBTransaction, oldVersion)
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
    // A page's copy of a setlist that was not in Drive yet has no link to its file: if a sync sent
    // it meanwhile, saving that copy as it is would drop the link, and the next sync would send
    // the setlist again as a second file. The link is the sync's (its own handle is a sync's)
    if (this.origin === 'local' && !stored.fileRef) {
      const current = (await requestResult(store.get(stored.id))) as Setlist | undefined
      if (current?.fileRef) {
        for (const field of SYNC_LINK_FIELDS) {
          if (current[field] !== undefined) stored[field] = current[field]
        }
      }
    }
    store.put(stored)
    const result = await transactionDone(tx, stored)
    this.#changed('setlist', [stored.id])
    return result
  }

  /**
   * Change a setlist as it is stored now: it is read, changed by `change` and written in one
   * transaction, so nothing saved since a page loaded it is undone (a page that saves its own
   * copy of a setlist writes over a link a sync made, or over a pull). `change` is given the
   * stored setlist to change in place, and must not wait; returning NO_CHANGE leaves it as it is.
   * @returns the setlist as stored once changed, or undefined if there is none or `change` returned NO_CHANGE
   */
  async updateSetlist(
    id: string,
    change: (setlist: Setlist) => unknown
  ): Promise<Setlist | undefined> {
    const tx = this.#transaction(['setlists'], 'readwrite')
    const store = tx.objectStore('setlists')
    const current = (await requestResult(store.get(id))) as Setlist | undefined
    if (!current) return undefined
    const draft = cloneForStorage(current) as Setlist
    if (change(draft) === NO_CHANGE) return undefined
    const stored = cloneForStorage(withNumericTempos(draft)) as Setlist
    store.put(stored)
    const result = await transactionDone(tx, stored)
    this.#changed('setlist', [id])
    return result
  }

  /**
   * Record that setlists were sent to Drive: what each keeps of its file is put on the setlist
   * as it is stored now, not on the copy that was sent, so that an edit saved while it was being
   * sent is not undone. (It is then a change the next sync sends: the content it was synced
   * with is the content that was sent.) A setlist deleted meanwhile is not put back.
   */
  async saveSetlistsSent(sent: Setlist[]): Promise<void> {
    if (sent.length === 0) return
    const tx = this.#transaction(['setlists'], 'readwrite')
    const store = tx.objectStore('setlists')
    for (const setlist of sent) {
      const current = (await requestResult(store.get(setlist.id))) as Setlist | undefined
      if (!current) continue
      const updated = { ...current }
      for (const field of SYNC_LINK_FIELDS) {
        if (setlist[field] !== undefined) updated[field] = setlist[field]
      }
      store.put(cloneForStorage(updated))
    }
    await transactionDone(tx)
    this.#changed(
      'setlist',
      sent.map(setlist => setlist.id)
    )
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

    await transactionDone(tx)
    this.#changed(
      'setlist',
      setlists.map(setlist => setlist.id)
    )
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
    this.#changed('setlist', [id])
  }

  // People (docs/IDENTITIES.md)

  async getAllPeople(): Promise<Person[]> {
    const tx = this.#transaction(['people'], 'readonly')
    return requestResult(tx.objectStore('people').getAll())
  }

  async getPerson(id: string): Promise<Person | undefined> {
    const tx = this.#transaction(['people'], 'readonly')
    return requestResult(tx.objectStore('people').get(id))
  }

  /**
   * Save people, each as given (a person already stored is replaced). A page's copy of a person
   * that was not in storage yet has no link to its file: if a sync sent it meanwhile, the link
   * is kept (as saveSetlist does), or the next sync would send the person again as a second file.
   */
  async savePeople(people: Person[]): Promise<void> {
    if (people.length === 0) return
    const tx = this.#transaction(['people'], 'readwrite')
    const store = tx.objectStore('people')
    for (const person of people) {
      const stored = cloneForStorage(person) as Person
      if (this.origin === 'local' && !stored.fileRef) {
        const current = (await requestResult(store.get(stored.id))) as Person | undefined
        if (current?.fileRef) {
          for (const field of PERSON_SYNC_FIELDS) {
            if (current[field] !== undefined)
              (stored as unknown as Record<string, unknown>)[field] = current[field]
          }
        }
      }
      store.put(stored)
    }
    await transactionDone(tx)
    this.#changed(
      'person',
      people.map(person => person.id)
    )
  }

  /**
   * Record that people were sent to storage: what each keeps of its file is put on the person as
   * stored now, not on the copy that was sent, so an edit saved while it was being sent is not
   * undone (it is a change the next sync sends).
   */
  async savePeopleSent(sent: Person[]): Promise<void> {
    if (sent.length === 0) return
    const tx = this.#transaction(['people'], 'readwrite')
    const store = tx.objectStore('people')
    for (const person of sent) {
      const current = (await requestResult(store.get(person.id))) as Person | undefined
      if (!current) continue
      const updated = { ...current }
      for (const field of PERSON_SYNC_FIELDS) {
        if (person[field] !== undefined) (updated as Record<string, unknown>)[field] = person[field]
      }
      store.put(cloneForStorage(updated))
    }
    await transactionDone(tx)
    this.#changed(
      'person',
      sent.map(person => person.id)
    )
  }

  /**
   * Add people who are not stored yet; one that is, is left as it is (it may have been changed
   * since the caller read the list). Resolves with those added.
   */
  async addPeople(people: Person[]): Promise<Person[]> {
    if (people.length === 0) return []
    const tx = this.#transaction(['people'], 'readwrite')
    const store = tx.objectStore('people')
    const added: Person[] = []
    for (const person of people) {
      if (await requestResult(store.getKey(person.id))) continue
      store.put(cloneForStorage(person))
      added.push(person)
    }
    await transactionDone(tx)
    if (added.length) {
      this.#changed(
        'person',
        added.map(person => person.id)
      )
    }
    return added
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
    // (as saveSetlist: a copy made before a sync sent the song must not drop the link to its file)
    if (this.origin === 'local' && !stored.fileRef) {
      const current = (await requestResult(store.get(stored.uuid))) as SongRecord | undefined
      if (current?.fileRef) {
        for (const field of SONG_LINK_FIELDS) {
          if (current[field] !== undefined) Object.assign(stored, { [field]: current[field] })
        }
      }
    }
    store.put(stored)
    const result = await transactionDone(tx, stored)
    this.#changed('song', [stored.uuid])
    return result
  }

  /** Change a song as it is stored now, as updateSetlist does a setlist (keyed by the song's uuid) */
  async updateSong(
    uuid: string,
    change: (song: SongRecord) => unknown
  ): Promise<SongRecord | undefined> {
    const tx = this.#transaction(['songs'], 'readwrite')
    const store = tx.objectStore('songs')
    const current = (await requestResult(store.get(uuid))) as SongRecord | undefined
    if (!current) return undefined
    const draft = cloneForStorage(current) as SongRecord
    if (change(draft) === NO_CHANGE) return undefined
    const stored = withNumericSongTempos(draft)
    store.put(stored)
    const result = await transactionDone(tx, stored)
    this.#changed('song', [uuid])
    return result
  }

  /**
   * Record that songs were sent to Drive (see saveSetlistsSent): what each keeps of its file goes
   * on the song as stored now. A song whose details were changed while it was sent is not marked
   * as synced, so the next sync sends it again.
   */
  async saveSongsSent(sent: SongRecord[]): Promise<void> {
    if (sent.length === 0) return
    const tx = this.#transaction(['songs'], 'readwrite')
    const store = tx.objectStore('songs')
    for (const song of sent) {
      const current = (await requestResult(store.get(song.uuid))) as SongRecord | undefined
      if (!current) continue
      const updated: SongRecord = { ...current }
      for (const field of SONG_LINK_FIELDS) {
        if (song[field] !== undefined) Object.assign(updated, { [field]: song[field] })
      }
      if ((current.metadataChangedAt ?? '') > (song.metadataChangedAt ?? '')) {
        updated.lastSyncedAt = current.lastSyncedAt
      }
      store.put(withNumericSongTempos(updated))
    }
    await transactionDone(tx)
    this.#changed(
      'song',
      sent.map(song => song.uuid)
    )
  }

  async saveSongsBatch(songs: SongInput[]): Promise<void> {
    if (songs.length === 0) return

    const tx = this.#transaction(['songs'], 'readwrite')
    const store = tx.objectStore('songs')

    for (const song of songs) {
      store.put(withNumericSongTempos(song))
    }

    await transactionDone(tx)
    this.#changed(
      'song',
      songs.map(song => song.uuid)
    )
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
    this.#changed('chart', [chordpro.id])
  }

  async getChordPro(id: string): Promise<ChordProRecord | undefined> {
    const tx = this.#transaction(['chordpro'], 'readonly')
    const store = tx.objectStore('chordpro')
    const request = store.get(id)
    return requestResult(request)
  }

  /** The charts with these ids, in this order (undefined for one that is not there), in one transaction */
  async getChordPros(ids: string[]): Promise<(ChordProRecord | undefined)[]> {
    const tx = this.#transaction(['chordpro'], 'readonly')
    const store = tx.objectStore('chordpro')
    return Promise.all(ids.map(id => requestResult(store.get(id))))
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

    const tx = this.#transaction(['setlists', 'people'], 'readonly')
    const setlists: Setlist[] = await requestResult(tx.objectStore('setlists').getAll())
    const people: Person[] = await requestResult(tx.objectStore('people').getAll())
    const appearances: SongUsage[] = []
    for (const setlist of setlists) {
      if (!Array.isArray(setlist.songs)) continue

      setlist.songs.forEach((song, index) => {
        if (song.songId !== songId) return

        appearances.push({
          songId: song.songId,
          songUuid: song.songUuid,
          setlistId: setlist.id,
          setlistDate: setlist.date,
          setlistName: setlist.name,
          leader: leaderName(people, setlist.leaderId),
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
    const tx = this.#transaction(['setlists', 'songs', 'chordpro', 'people', 'scores'], 'readwrite')
    for (const name of ['setlists', 'songs', 'chordpro', 'people', 'scores']) {
      tx.objectStore(name).clear()
    }
    await transactionDone(tx)
    this.#changedAll()
  }

  /**
   * Forget every link to Drive: each setlist and song is left as a new one that Drive has never
   * seen, so the next sync uploads it all. Content stays; a setlist's share link goes, since
   * its file was in the folder that is let go. Used to start over in a new Drive folder.
   */
  async clearFileLinks(): Promise<void> {
    const tx = this.#transaction(['setlists', 'songs', 'people', 'scores'], 'readwrite')
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
    const people = tx.objectStore('people')
    const peopleRequest = people.getAll()
    peopleRequest.onsuccess = () => {
      for (const person of peopleRequest.result as Person[]) {
        people.put({ ...person, ...unlinked })
      }
    }
    const melodies = tx.objectStore('scores')
    const melodiesRequest = melodies.getAll()
    melodiesRequest.onsuccess = () => {
      for (const record of melodiesRequest.result as ScoreRecord[]) {
        melodies.put({ ...record, ...unlinked })
      }
    }
    await transactionDone(tx)
    this.#changed('setlist', null)
    this.#changed('song', null)
    this.#changed('person', null)
    this.#changed('score', null)
  }

  /**
   * Let go of the files with these refs, keeping the setlists and songs: each is as one that was
   * never uploaded, so the next push makes a new file. For records kept although their file is
   * gone (they were edited here), by a sync that is told of a file once and cannot list the rest.
   * @returns how many records were let go
   */
  async unlinkFiles(refs: Set<string>): Promise<number> {
    const tx = this.#transaction(['setlists', 'songs', 'scores'], 'readwrite')
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
    const melodies = tx.objectStore('scores')
    const melodiesRequest = melodies.getAll()
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
    melodiesRequest.onsuccess = () => {
      for (const record of melodiesRequest.result as ScoreRecord[]) {
        if (!record.fileRef || !refs.has(record.fileRef)) continue
        melodies.put({ ...record, ...unlinked })
        count++
      }
    }
    await transactionDone(tx)
    if (count > 0) {
      this.#changed('setlist', null)
      this.#changed('song', null)
      this.#changed('score', null)
    }
    return count
  }

  // Melodies (docs/MELODY.md)

  async getScore(uuid: string): Promise<ScoreRecord | undefined> {
    const tx = this.#transaction(['scores'], 'readonly')
    return requestResult(tx.objectStore('scores').get(uuid))
  }

  async getAllScores(): Promise<ScoreRecord[]> {
    const tx = this.#transaction(['scores'], 'readonly')
    return requestResult(tx.objectStore('scores').getAll())
  }

  async saveScore(record: ScoreRecord): Promise<void> {
    const tx = this.#transaction(['scores'], 'readwrite')
    tx.objectStore('scores').put(record)
    await transactionDone(tx)
    this.#changed('score', [record.uuid])
  }

  /**
   * Record that melodies were sent to Drive: what each keeps of its file is put on the record as
   * it is stored now, not on the copy that was sent, so a change saved while it was being sent is
   * not undone (it is then a change the next sync sends). A melody deleted meanwhile is not put back.
   */
  async saveScoresSent(sent: ScoreRecord[]): Promise<void> {
    if (sent.length === 0) return
    const tx = this.#transaction(['scores'], 'readwrite')
    const store = tx.objectStore('scores')
    for (const record of sent) {
      const current = (await requestResult(store.get(record.uuid))) as ScoreRecord | undefined
      if (!current) continue
      const updated: ScoreRecord = {
        ...current,
        fileRef: record.fileRef,
        fileRev: record.fileRev,
        fileModified: record.fileModified,
        lastSyncedAt: record.lastSyncedAt,
        syncedContentHash: record.syncedContentHash,
      }
      // (written with the file's new name and properties: not a legacy file now)
      if (!record.legacyFile) delete updated.legacyFile
      store.put(updated)
    }
    await transactionDone(tx)
    this.#changed(
      'score',
      sent.map(record => record.uuid)
    )
  }

  /**
   * Delete a melody. If it has a file in Drive, that is noted, for the next sync to put in the
   * Drive trash, or the file would bring it back. A melody deleted because Drive no longer has
   * its file passes `remember: false`.
   */
  async deleteScore(uuid: string, { remember = true }: { remember?: boolean } = {}): Promise<void> {
    const record = await this.getScore(uuid)
    if (!record) return
    const tx = this.#transaction(['scores', 'pending_deletions'], 'readwrite')
    tx.objectStore('scores').delete(uuid)
    if (remember && record.fileRef) {
      const pending: PendingDeletion = {
        ref: record.fileRef,
        kind: 'score',
        deletedAt: new Date().toISOString(),
      }
      tx.objectStore('pending_deletions').put(pending)
    }
    await transactionDone(tx)
    this.#changed('score', [uuid])
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
      this.#changed('chart', [song.chordproFileId])
    }
    // Its melody goes with it, and its file is put in the trash even when the song's was not (a song
    // deleted because Drive no longer has its chart left its melody's file there)
    await this.deleteScore(uuid)
    this.#changed('song', [uuid])
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
      ['setlists', 'songs', 'chordpro', 'setlist_local', 'pending_deletions', 'people', 'scores'],
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
    await tx.objectStore('people').clear()
    await tx.objectStore('scores').clear()

    await transactionDone(tx)
    this.#changedAll()
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
 * Bring a database of at least `OLDEST_UPGRADABLE` up to date (what is older is not upgraded: see
 * docs/MIGRATIONS.md, "The floor"). The steps of versions before 14 were dropped when that floor was set;
 * `git log -S` finds them.
 *
 * Version 15: the `melodies` store is `scores`, and a pending deletion of a melody's file is of a score's.
 * Their files in Drive keep the old name and properties until a device that can write rewrites them,
 * which `legacyFile` says.
 */
function upgradeRecords(transaction: IDBTransaction, oldVersion: number) {
  if (oldVersion < 15) {
    migrateMelodiesToScores(transaction)
    migratePendingDeletionKinds(transaction)
  }
}

/** Version 15: the records of the `melodies` store are put in `scores`, and the old store goes */
function migrateMelodiesToScores(transaction: IDBTransaction) {
  const old = transaction.objectStore('melodies')
  const read = old.getAll()
  read.onsuccess = () => {
    const scores = transaction.objectStore('scores')
    for (const record of read.result as ScoreRecord[]) {
      scores.put(record.fileRef ? { ...record, legacyFile: true } : record)
    }
    transaction.db.deleteObjectStore('melodies')
  }
}

function migratePendingDeletionKinds(transaction: IDBTransaction) {
  const pending = transaction.objectStore('pending_deletions')
  const cursor = pending.openCursor()
  cursor.onsuccess = () => {
    const at = cursor.result
    if (!at) return
    const entry = at.value as { kind: string }
    if (entry.kind === 'melody') at.update({ ...entry, kind: 'score' })
    at.continue()
  }
}

/**
 * Helper to get current space database
 * Returns a database instance for the currently active space
 */
export async function getCurrentDB(origin?: DataOrigin): Promise<ChordlessDB> {
  const { ensureCurrentSpace } = await import('./space.ts')
  const { id } = await ensureCurrentSpace()
  return openSpace(id, origin)
}

/** The database of a space, which need not be the current one (an import may go to another) */
export async function openSpace(spaceId: string, origin?: DataOrigin): Promise<ChordlessDB> {
  const db = new ChordlessDB(spaceId, origin)
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
  leaderId,
  createdBy,
}: {
  date?: string | Date
  time?: string
  type?: string
  name?: string
  leaderId?: string | null
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
    ...(leaderId ? { leaderId } : {}),
    ...(createdBy ? { createdBy } : {}),
    songs: [],
    createdDate: new Date().toISOString(),
    modifiedDate: new Date().toISOString(),
  }
}
