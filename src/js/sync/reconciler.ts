// Generic reconciliation helpers for sync unit tests and future refactors.
// Accepts in-memory local/remote states and produces a plan of actions
// (upload, download, delete, noop) without touching IndexedDB or Drive APIs.

/** What reconciling needs of a song or setlist record */
interface SyncRecord {
  id?: string
  deletedAt?: string | null
  modifiedDate?: string | number | Date | null
}

export type PlanAction = 'upload' | 'download' | 'deleteRemote' | 'deleteLocal' | 'noop'

export interface PlanEntry<T extends SyncRecord> {
  action: PlanAction
  entityType: string
  id: string | undefined
  record: T | undefined
}

export interface ReconcileOptions {
  /** On a tie in modified date: take the remote copy (the default) or upload the local one */
  preferRemoteOnConflict?: boolean
  entityType?: string
}

function toMap<T extends SyncRecord>(records: T[]): Map<string, T> {
  const map = new Map<string, T>()
  records.forEach(record => {
    if (record?.id) {
      map.set(record.id, record)
    }
  })
  return map
}

function normalizeDate(value: SyncRecord['modifiedDate']): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function buildEntry<T extends SyncRecord>(
  action: PlanAction,
  entityType: string,
  record: T | undefined
): PlanEntry<T> {
  return { action, entityType, id: record?.id, record }
}

export function reconcileRecords<T extends SyncRecord>(
  localRecords: T[] = [],
  remoteRecords: T[] = [],
  options: ReconcileOptions = {}
): PlanEntry<T>[] {
  const { preferRemoteOnConflict = true, entityType = 'record' } = options

  const plan: PlanEntry<T>[] = []
  const localMap = toMap(localRecords)
  const remoteMap = toMap(remoteRecords)
  const ids = new Set([...localMap.keys(), ...remoteMap.keys()])

  ids.forEach(id => {
    const local = localMap.get(id)
    const remote = remoteMap.get(id)

    const localDeleted = Boolean(local?.deletedAt)
    const remoteDeleted = Boolean(remote?.deletedAt)

    if (!remote) {
      if (!localDeleted) {
        plan.push(buildEntry('upload', entityType, local))
      }
      return
    }

    if (!local) {
      if (!remoteDeleted) {
        plan.push(buildEntry('download', entityType, remote))
      }
      return
    }

    if (localDeleted && !remoteDeleted) {
      plan.push(buildEntry('deleteRemote', entityType, local))
      return
    }

    if (remoteDeleted && !localDeleted) {
      plan.push(buildEntry('deleteLocal', entityType, remote))
      return
    }

    if (localDeleted && remoteDeleted) {
      plan.push(buildEntry('noop', entityType, local))
      return
    }

    const localUpdated = normalizeDate(local.modifiedDate)
    const remoteUpdated = normalizeDate(remote.modifiedDate)

    if (localUpdated > remoteUpdated) {
      plan.push(buildEntry('upload', entityType, local))
    } else if (remoteUpdated > localUpdated) {
      plan.push(buildEntry('download', entityType, remote))
    } else if (preferRemoteOnConflict) {
      plan.push(buildEntry('download', entityType, remote))
    } else {
      plan.push(buildEntry('upload', entityType, local))
    }
  })

  return plan
}

export function reconcileSetlists<T extends SyncRecord>(
  local: T[] = [],
  remote: T[] = [],
  options: ReconcileOptions = {}
) {
  return reconcileRecords(local, remote, { ...options, entityType: 'setlist' })
}

export function reconcileSongs<T extends SyncRecord>(
  local: T[] = [],
  remote: T[] = [],
  options: ReconcileOptions = {}
) {
  return reconcileRecords(local, remote, { ...options, entityType: 'song' })
}
