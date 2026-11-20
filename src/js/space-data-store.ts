/** Atomic local snapshots, queued changes and acknowledgements for space-data sync. */
import { announceDataChange } from './data-changes.ts'
import type { Setlist, SongRecord, SpaceOutboxRecord } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { mergeSpaceRecord } from './space-data-merge.ts'
import {
  localRecord,
  recordId,
  SPACE_STORES,
  type SpaceRecord,
  sameContent,
  sharedRecord,
} from './space-data-records.ts'
import type {
  SpaceData,
  SpaceOpResult,
  SpacePadSet,
  SpaceRecordKind,
  SpaceSong,
} from './space-data-types.ts'
import { ulid } from './ulid.ts'
import { requestResult, transactionDone } from './utils/idb.ts'

/** A committed outbox edit is ready to send, including file links written by the Drive sync. */
export class SpaceOutboxChangedEvent extends Event {
  static readonly type = 'space-data:queued'
  readonly spaceId: string
  constructor(spaceId: string) {
    super(SpaceOutboxChangedEvent.type)
    this.spaceId = spaceId
  }
}

export interface SpaceDataState {
  id: 'state'
  enabled: boolean
  probing?: boolean
  checked?: boolean
  etag: string | null
  complete: boolean
}
const emptyState = (): SpaceDataState => ({
  id: 'state',
  enabled: false,
  etag: null,
  complete: false,
})
const kinds = ['song', 'setlist', 'person', 'pad-set'] as const
const storeNames = [
  'space_data',
  'space_outbox',
  'song_index',
  'songs',
  'setlists',
  'people',
  'pad_sets',
]

/** Called BEFORE replacing a record, in the very transaction that makes the local edit. */
export async function queueSpaceChange(
  tx: IDBTransaction,
  kind: SpaceRecordKind,
  id: string,
  next: unknown
): Promise<void> {
  const state: SpaceDataState | undefined = await requestResult(
    tx.objectStore('space_data').get('state')
  )
  if (!state?.enabled && !state?.probing) return
  const store = tx.objectStore(SPACE_STORES[kind])
  const previous = sharedRecord(kind, await requestResult(store.get(id)))
  const record = sharedRecord(kind, next)
  if (sameContent(previous, record)) return
  const outbox = tx.objectStore('space_outbox')
  const waiting: SpaceOutboxRecord[] = await requestResult(
    outbox.index('record').getAll([kind, id])
  )
  const first = waiting[0]
  const base = first ? first.base : previous
  for (const entry of waiting) outbox.delete(entry.id)
  const entry: SpaceOutboxRecord = {
    id: ulid(),
    base,
    change: {
      kind,
      id,
      op: record ? 'put' : 'delete',
      baseVersion: first ? first.change.baseVersion : previous?.version || null,
      ...(record ? { record } : {}),
    },
  }
  outbox.put(entry)
  tx.addEventListener(
    'complete',
    () => window.dispatchEvent(new SpaceOutboxChangedEvent(tx.db.name)),
    { once: true }
  )
}

function validRecord(kind: SpaceRecordKind, record: SpaceRecord): boolean {
  if (
    !record ||
    typeof recordId(kind, record) !== 'string' ||
    !recordId(kind, record) ||
    !Number.isInteger(record.version) ||
    record.version < 1 ||
    typeof record.modifiedAt !== 'string'
  )
    return false
  if (kind === 'setlist') {
    const row = record as import('./space-data-types.ts').SpaceSetlist
    return (
      typeof row.date === 'string' &&
      typeof row.name === 'string' &&
      typeof row.time === 'string' &&
      typeof row.type === 'string' &&
      typeof row.createdAt === 'string' &&
      !!row.body &&
      typeof row.body === 'object' &&
      Array.isArray(row.songs) &&
      row.songs.every(
        entry =>
          entry &&
          typeof entry.songUuid === 'string' &&
          typeof entry.songId === 'string' &&
          typeof entry.title === 'string' &&
          typeof entry.notes === 'string' &&
          Array.isArray(entry.annotations)
      )
    )
  }
  if (kind === 'person') {
    const row = record as import('./space-data-types.ts').SpacePerson
    return (
      typeof row.name === 'string' &&
      Array.isArray(row.emails) &&
      row.emails.every(email => typeof email === 'string')
    )
  }
  if (kind === 'song') {
    const row = record as SpaceSong
    return (
      typeof row.songId === 'string' &&
      typeof row.title === 'string' &&
      typeof row.isDefault === 'boolean'
    )
  }
  return typeof (record as SpacePadSet).name === 'string'
}

export class SpaceDataStore {
  constructor(db: ChordlessDB) {
    this.#db = db
  }
  readonly #db: ChordlessDB

  #tx(mode: IDBTransactionMode): IDBTransaction {
    if (!this.#db.db) throw new Error('Space database is not open')
    return this.#db.db.transaction(storeNames, mode)
  }

  async state(): Promise<SpaceDataState> {
    return (
      (await requestResult(this.#tx('readonly').objectStore('space_data').get('state'))) ??
      emptyState()
    )
  }

  /** Probe first so edits made during the first request are queued too. Drive-only spaces discard this probe. */
  async probe({ onlyUnknown = false }: { onlyUnknown?: boolean } = {}): Promise<void> {
    const tx = this.#tx('readwrite')
    const store = tx.objectStore('space_data')
    const state: SpaceDataState = (await requestResult(store.get('state'))) ?? emptyState()
    if (!state.enabled && (!onlyUnknown || !state.checked)) store.put({ ...state, probing: true })
    await transactionDone(tx)
  }

  async notMoved(): Promise<void> {
    const tx = this.#tx('readwrite')
    tx.objectStore('space_data').put({ ...emptyState(), checked: true })
    tx.objectStore('space_outbox').clear()
    await transactionDone(tx)
  }

  async pending(): Promise<SpaceOutboxRecord[]> {
    return requestResult(this.#tx('readonly').objectStore('space_outbox').getAll())
  }

  #changed(kind: SpaceRecordKind): void {
    announceDataChange({
      spaceId: this.#db.spaceId,
      kind,
      ids: null,
      origin: 'sync',
    })
  }

  async apply(data: SpaceData, etag: string | null): Promise<void> {
    // Validate before the transaction: a malformed response must not commit a partial replacement.
    for (const [kind, records] of [
      ['song', data.songs],
      ['setlist', data.setlists],
      ['person', data.people],
      ['pad-set', data.padSets],
    ] as const) {
      if (
        !Array.isArray(records) ||
        records.some(record => !validRecord(kind, record)) ||
        new Set(records.map(record => recordId(kind, record))).size !== records.length
      )
        throw new Error('Invalid space snapshot')
    }
    if (data.from !== null && !/^\d{4}-\d{2}-\d{2}$/.test(data.from))
      throw new Error('Invalid snapshot window')
    const tx = this.#tx('readwrite')
    const pending: SpaceOutboxRecord[] = await requestResult(
      tx.objectStore('space_outbox').getAll()
    )
    for (const [kind, records] of [
      ['song', data.songs],
      ['setlist', data.setlists],
      ['person', data.people],
      ['pad-set', data.padSets],
    ] as const) {
      const protectedIds = new Set(
        pending.filter(entry => entry.change.kind === kind).map(entry => entry.change.id)
      )
      const store = tx.objectStore(SPACE_STORES[kind])
      const existing = await requestResult(store.getAll())
      const incoming = new Set(records.map(record => recordId(kind, record)))
      for (const current of existing) {
        const id = kind === 'setlist' || kind === 'person' ? current.id : recordId(kind, current)
        if (protectedIds.has(id) || incoming.has(id)) continue
        if (kind === 'setlist' && data.from !== null && (current as Setlist).date < data.from)
          continue
        store.delete(id)
        if (kind === 'song') tx.objectStore('songs').delete(id)
      }
      for (const record of records) {
        const id = recordId(kind, record)
        if (protectedIds.has(id)) {
          const held = pending.find(entry => entry.change.kind === kind && entry.change.id === id)
          if (held?.refusal && held.change.op === 'put') {
            const merged = mergeSpaceRecord(
              kind,
              held.base as SpaceRecord | null,
              held.change.record as SpaceRecord,
              record
            )
            tx.objectStore('space_outbox').put({
              ...held,
              base: record,
              change: { ...held.change, baseVersion: record.version, record: merged.record },
            })
            await this.#put(tx, kind, merged.record)
          }
          continue
        }
        await this.#put(tx, kind, record)
      }
    }
    const state: SpaceDataState =
      (await requestResult(tx.objectStore('space_data').get('state'))) ?? emptyState()
    tx.objectStore('space_data').put({
      ...state,
      enabled: true,
      checked: true,
      probing: false,
      etag,
      complete: state.complete || data.from === null,
    })
    await transactionDone(tx)
    for (const kind of kinds) this.#changed(kind)
  }

  async #put(tx: IDBTransaction, kind: SpaceRecordKind, record: SpaceRecord): Promise<void> {
    const id = recordId(kind, record)
    const store = tx.objectStore(SPACE_STORES[kind])
    const previous = await requestResult(store.get(id))
    store.put(localRecord(kind, record, previous))
    if (kind === 'song') {
      const song = record as SpaceSong
      const local: SongRecord | undefined = await requestResult(tx.objectStore('songs').get(id))
      if (local)
        tx.objectStore('songs').put({
          ...local,
          title: song.title,
          ccliNumber: song.ccli,
          key: song.key,
          isDefault: song.isDefault,
          variantOf: song.variantOf,
          variantLabel: song.variantLabel,
          licence: song.licence,
          version: song.version,
          fileRef: song.fileRef,
        })
    }
  }

  /** Apply one response without erasing edits saved while the request was in flight. */
  async settle(
    sent: SpaceOutboxRecord,
    result: SpaceOpResult
  ): Promise<{ conflict: boolean; refusal?: string }> {
    const tx = this.#tx('readwrite')
    const outbox = tx.objectStore('space_outbox')
    const waiting: SpaceOutboxRecord[] = await requestResult(
      outbox.index('record').getAll([sent.change.kind, sent.change.id])
    )
    const current = waiting[0]
    if (!current) {
      await transactionDone(tx)
      return { conflict: false }
    }
    const { kind, id } = sent.change
    let conflict = false
    let refusal: string | undefined
    const fresh = result.status === 'conflict' ? (result.current as SpaceRecord | null) : null
    const accepted =
      result.status === 'ok' || (result.status === 'missing' && sent.change.op === 'delete')
    if (accepted) {
      const version = result.status === 'ok' ? result.version : 0
      const server =
        sent.change.op === 'put' ? { ...(sent.change.record as SpaceRecord), version } : null
      if (current.id === sent.id) {
        outbox.delete(current.id)
        if (server) await this.#put(tx, kind, server)
      } else {
        // The newer edit already contains the accepted edit; its base is now the accepted row.
        outbox.put({
          ...current,
          base: server,
          change: { ...current.change, baseVersion: version || null },
        })
        const store = tx.objectStore(SPACE_STORES[kind])
        const local = await requestResult(store.get(id))
        if (local) store.put({ ...local, version })
      }
      // A queued edit can only exist after probe/apply wrote the checkpoint.
      const state = (await requestResult(
        tx.objectStore('space_data').get('state')
      )) as SpaceDataState
      tx.objectStore('space_data').put({ ...state, etag: null })
    } else if (result.status === 'conflict' && fresh) {
      // Use the latest pending edit, which may be newer than the one that received the 409.
      const merge =
        current.change.op === 'put'
          ? mergeSpaceRecord(
              kind,
              current.base as SpaceRecord | null,
              current.change.record as SpaceRecord,
              fresh
            )
          : { record: fresh, conflict: !sameContent(current.base, fresh) }
      conflict = merge.conflict
      if (current.change.op === 'put' && sameContent(merge.record, fresh)) {
        outbox.delete(current.id)
        await this.#put(tx, kind, fresh)
      } else {
        const record = { ...merge.record, version: fresh.version }
        outbox.put({
          ...current,
          id: ulid(),
          base: fresh,
          change: {
            ...current.change,
            baseVersion: fresh.version,
            ...(current.change.op === 'put' ? { record } : {}),
          },
        })
        outbox.delete(current.id)
        if (current.change.op === 'put') await this.#put(tx, kind, record)
      }
    } else if (current.id === sent.id) {
      refusal =
        result.status === 'invalid' || result.status === 'forbidden' ? result.error : result.status
      // Keep the local edit, including a reader's local-only edit, and stop retrying a permanent refusal.
      outbox.put({ ...current, refusal: { status: result.status, reason: refusal } })
    }
    await transactionDone(tx)
    this.#changed(kind)
    return { conflict, refusal }
  }

  async retryRefused(): Promise<void> {
    const tx = this.#tx('readwrite')
    const store = tx.objectStore('space_outbox')
    const entries: SpaceOutboxRecord[] = await requestResult(store.getAll())
    for (const entry of entries) {
      const { refusal: _refusal, ...retry } = entry
      store.put(retry)
    }
    await transactionDone(tx)
  }

  async padSets(): Promise<SpacePadSet[]> {
    return requestResult(this.#tx('readonly').objectStore('pad_sets').getAll())
  }

  async deletePadSet(id: string): Promise<void> {
    const tx = this.#tx('readwrite')
    await queueSpaceChange(tx, 'pad-set', id, null)
    tx.objectStore('pad_sets').delete(id)
    await transactionDone(tx)
    announceDataChange({ spaceId: this.#db.spaceId, kind: 'pad-set', ids: [id], origin: 'local' })
  }

  async savePadSet(pad: SpacePadSet): Promise<void> {
    const tx = this.#tx('readwrite')
    await queueSpaceChange(tx, 'pad-set', pad.padSetId, pad)
    tx.objectStore('pad_sets').put(pad)
    await transactionDone(tx)
    announceDataChange({
      spaceId: this.#db.spaceId,
      kind: 'pad-set',
      ids: [pad.padSetId],
      origin: 'local',
    })
  }
}
