let pendingPersistPromise = null

/** Log the persistence result once per tab, rather than on every page load */
function logOncePerTab(message) {
  try {
    if (sessionStorage.getItem('storage-persist-logged') === message) return
    sessionStorage.setItem('storage-persist-logged', message)
  } catch {
    // No sessionStorage: log every time
  }
  console.info(message)
}

export function ensurePersistentStorage(reason = 'app data') {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return Promise.resolve(false)
  }

  if (!pendingPersistPromise) {
    pendingPersistPromise = (async () => {
      try {
        if (await navigator.storage.persisted()) {
          return true
        }
        // Ask on every load: browsers decide for themselves (Chrome grants it
        // once the app is installed), so a refusal now may be a grant later
        const granted = await navigator.storage.persist()
        logOncePerTab(
          granted
            ? `[Storage] Persistent storage granted (${reason})`
            : `[Storage] Storage is best-effort; installing the app makes it persistent (${reason})`
        )
        return granted
      } catch (error) {
        console.warn('[Storage] Failed to request persistent storage:', error)
        return false
      }
    })()
  }

  return pendingPersistPromise
}
