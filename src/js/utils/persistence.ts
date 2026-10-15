/**
 * Ask the browser to keep the app's data (IndexedDB, caches) rather than clear it when space is
 * short. Asked once for a page, however many databases ask. `storage` and `sessionOf` are what
 * a test replaces.
 */
export function persistentStorageRequester(
  storage: Pick<StorageManager, 'persist' | 'persisted'> | null = navigator.storage,
  sessionOf: () => Pick<Storage, 'getItem' | 'setItem'> = () => sessionStorage
) {
  let pending: Promise<boolean> | null = null

  /** Log the persistence result once per tab, rather than on every page load */
  function logOncePerTab(message: string) {
    try {
      const session = sessionOf()
      if (session.getItem('storage-persist-logged') === message) return
      session.setItem('storage-persist-logged', message)
    } catch {
      // No sessionStorage: log every time
    }
    console.info(message)
  }

  return function ensurePersistentStorage(reason = 'app data'): Promise<boolean> {
    if (!storage?.persist) return Promise.resolve(false)
    const { persist, persisted } = storage

    if (!pending) {
      pending = (async () => {
        try {
          if (await persisted.call(storage)) {
            return true
          }
          // Ask on every load: browsers decide for themselves (Chrome grants it
          // once the app is installed), so a refusal now may be a grant later
          const granted = await persist.call(storage)
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

    return pending
  }
}

export const ensurePersistentStorage = persistentStorageRequester()
