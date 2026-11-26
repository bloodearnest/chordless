/**
 * A setlist's share link when its space is stored on Chordless (docs/CENTRAL_STORAGE.md, "Anonymous sharing"): the link is
 * the Worker's own (`/s/sh_…`), not a Drive file, and it carries no key. It is no copy: it lets anyone who holds it read the
 * setlist as it is now, until it ends, so there is nothing to update. The leader's calls are in worker/src/shares.ts.
 */
import { callWorker, TeamError, type WorkerConnection } from './worker-call.ts'

export interface ServerShare {
  shareId: string
  /** When the link stops working (an ISO time) */
  expiresAt: string
}

/** The link to give out for a share */
export const serverShareUrl = (origin: string, shareId: string) =>
  `${origin}/s/${encodeURIComponent(shareId)}`

/** The setlist's live share, or null if it has none */
export async function findServerShare(
  connection: WorkerConnection,
  setlistId: string
): Promise<ServerShare | null> {
  try {
    const response = await callWorker({ path: '/api/shares', query: { setlistId } }, connection)
    return (await response.json()) as ServerShare
  } catch (error) {
    if (error instanceof TeamError && error.status === 404) return null
    throw error
  }
}

/** Share a setlist (the Worker has it already: sync first). A setlist already shared gives its link. */
export async function createServerShare(
  connection: WorkerConnection,
  setlistId: string
): Promise<ServerShare> {
  try {
    const response = await callWorker(
      { method: 'POST', path: '/api/shares', body: { setlistId } },
      connection
    )
    return (await response.json()) as ServerShare
  } catch (error) {
    // (another of the leader's devices shared it first: that link is the one)
    if (error instanceof TeamError && error.status === 409) {
      const existing = await findServerShare(connection, setlistId)
      if (existing) return existing
    }
    throw error
  }
}

/** Stop a share: the link stops working at once */
export async function stopServerShare(
  connection: WorkerConnection,
  shareId: string
): Promise<void> {
  await callWorker(
    { method: 'DELETE', path: `/api/shares/${encodeURIComponent(shareId)}` },
    connection
  )
}
