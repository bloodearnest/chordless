/**
 * One sync at a time, across every page and tab of the app: two syncs of a space at once could
 * each upload a file the other is about to (docs/SYNC_ARCHITECTURE.md, "Pulling while the app is
 * open"). A person's press of Sync waits its turn; a sync the app starts by itself is skipped if
 * one is running, as the next tick does it. Without Web Locks (none is expected within the
 * browser floor) the work just runs.
 */
const LOCK_NAME = 'chordless-sync'

/** Run `work` once no other sync is running; with `skipIfBusy`, not at all if one is */
export async function withSyncLock<T>(
  work: () => Promise<T>,
  { skipIfBusy = false }: { skipIfBusy?: boolean } = {}
): Promise<{ ran: true; value: T } | { ran: false }> {
  if (!navigator.locks) return { ran: true, value: await work() }
  return navigator.locks.request(LOCK_NAME, { ifAvailable: skipIfBusy }, async lock => {
    if (!lock) return { ran: false as const }
    return { ran: true as const, value: await work() }
  })
}
