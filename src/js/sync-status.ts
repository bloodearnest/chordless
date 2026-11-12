/**
 * Which spaces are syncing now, and how far each has got, for whatever page wants to say so (the
 * home page of a team space that has not been fetched yet, docs/SPACES.md, "Teams on another
 * device"). Every sync of a space goes through `trackSync`: the orchestrator's operations and the
 * first sync of a team space just set up. A sync that finishes is noted as the space's last
 * (`recordSync`), which is how a space is told from one never fetched.
 */
import { recordSync } from './last-sync.ts'
import type { SyncProgress } from './sync/session.ts'

/** A space started or finished syncing, or said how far it has got (sent on window) */
export class SyncStatusEvent extends Event {
  static readonly type = 'sync-status:change'
  readonly spaceId: string
  constructor(spaceId: string) {
    super(SyncStatusEvent.type)
    this.spaceId = spaceId
  }
}

declare global {
  interface WindowEventMap {
    [SyncStatusEvent.type]: SyncStatusEvent
  }
}

interface Running {
  /** How many syncs of the space are running (one waits for another, but a count is safe) */
  count: number
  progress: SyncProgress | null
}

const running = new Map<string, Running>()

/** The space's sync, if one is running now, with how far it has got */
export function syncRunning(spaceId: string): { progress: SyncProgress | null } | null {
  return running.get(spaceId) ?? null
}

/**
 * Run a sync of the space, telling of it as it goes; when it finishes without failing the space has
 * synced. With no space (one not made yet) there is nothing to tell.
 */
export async function trackSync<T>(
  spaceId: string | null,
  run: (report: (progress: SyncProgress) => void) => Promise<T>
): Promise<T> {
  if (!spaceId) return run(() => {})
  const entry = running.get(spaceId) ?? { count: 0, progress: null }
  entry.count++
  running.set(spaceId, entry)
  window.dispatchEvent(new SyncStatusEvent(spaceId))
  try {
    const result = await run(progress => {
      entry.progress = progress
      window.dispatchEvent(new SyncStatusEvent(spaceId))
    })
    recordSync(spaceId)
    return result
  } finally {
    if (--entry.count <= 0) running.delete(spaceId)
    window.dispatchEvent(new SyncStatusEvent(spaceId))
  }
}
