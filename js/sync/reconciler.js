// Generic reconciliation helpers for sync unit tests and future refactors.
// Accepts in-memory local/remote states and produces a plan of actions
// (upload, download, delete, noop) without touching IndexedDB or Drive APIs.

function toMap(records = []) {
  const map = new Map()
  records.forEach(record => {
    if (record && record.id) {
      map.set(record.id, record)
    }
  })
  return map
}

function normalizeDate(value) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function buildEntry(action, entityType, record) {
  return { action, entityType, id: record?.id, record }
}

export function reconcileRecords(localRecords = [], remoteRecords = [], options = {}) {
  const { preferRemoteOnConflict = true, entityType = 'record' } = options

  const plan = []
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

export function reconcileSetlists(local = [], remote = [], options = {}) {
  return reconcileRecords(local, remote, { ...options, entityType: 'setlist' })
}

export function reconcileSongs(local = [], remote = [], options = {}) {
  return reconcileRecords(local, remote, { ...options, entityType: 'song' })
}
