let pendingPersistPromise = null;

export function ensurePersistentStorage(reason = 'app data') {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
        return Promise.resolve(false);
    }

    if (!pendingPersistPromise) {
        pendingPersistPromise = (async () => {
            try {
                if (await navigator.storage.persisted()) {
                    return true;
                }
                const granted = await navigator.storage.persist();
                if (!granted) {
                    console.warn('[Storage] Persistent storage not granted');
                } else {
                    console.log('[Storage] Persistent storage granted');
                }
                return granted;
            } catch (error) {
                console.warn('[Storage] Failed to request persistent storage:', error);
                return false;
            }
        })();
    }

    return pendingPersistPromise;
}
