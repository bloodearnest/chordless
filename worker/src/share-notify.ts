/**
 * Telling a share's live room that what it shows has changed (docs/LIVE_SYNC.md, "Share links"). A share the Worker keeps
 * reads the real setlist and its songs, so the Worker itself knows when it changed: a setlist written, or a song of it
 * written. It says "changed" to the room of each live share of it, and a reader who is live on the share fetches it again.
 * No device of the leader's takes part, so a change made on any device, or by another leader, reaches the readers. It is
 * best effort: a reader finds a change that was missed when they next open the link, and nothing a person did is refused
 * for want of this.
 */
import type { SpaceOpResult } from '../../src/js/space-data-types.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import { isRecord } from './http.ts'

/** The setlists a batch changed: those of its writes that were made */
export function changedSetlists(ops: unknown[], results: SpaceOpResult[]): string[] {
  return ops.flatMap((op, index) =>
    results[index]?.status === 'ok' && isRecord(op) && typeof op.id === 'string' ? [op.id] : []
  )
}

/** The live shares of these setlists */
async function sharesOfSetlists(db: D1Db, setlistIds: string[]): Promise<string[]> {
  if (!setlistIds.length) return []
  const { results } = await db
    .prepare(
      `SELECT share_id FROM shares WHERE stopped_at IS NULL AND setlist_id IN (SELECT value FROM json_each(?))`
    )
    .bind(JSON.stringify(setlistIds))
    .all<{ share_id: string }>()
  return results.map(row => row.share_id)
}

/** The live shares of the setlists that have this song in them */
async function sharesOfSong(db: D1Db, songUuid: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT sh.share_id FROM shares sh JOIN setlists s ON s.setlist_id = sh.setlist_id
       WHERE sh.stopped_at IS NULL AND EXISTS (
         SELECT 1 FROM json_each(s.songs) j WHERE json_extract(j.value, '$.songUuid') = ?)`
    )
    .bind(songUuid)
    .all<{ share_id: string }>()
  return results.map(row => row.share_id)
}

async function ring(env: Env, shareIds: string[]): Promise<void> {
  // (the callers have checked that there are rooms)
  const rooms = env.SHARE_ROOM as NonNullable<Env['SHARE_ROOM']>
  await Promise.all(
    shareIds.map(async id => {
      try {
        // (a POST is the Worker's own word to the room: a device's request to it is always a socket)
        await rooms
          .get(rooms.idFromName(id))
          .fetch(new Request('https://share-room/changed', { method: 'POST' }))
      } catch (error) {
        console.warn('[Share] Could not tell the live room of a share:', error)
      }
    })
  )
}

/** Tell the live shares of these setlists that they changed */
export async function notifySetlistShares(env: Env, setlistIds: string[]): Promise<void> {
  if (!env.DB || !env.SHARE_ROOM) return
  try {
    await ring(env, await sharesOfSetlists(env.DB, setlistIds))
  } catch (error) {
    console.warn('[Share] Could not look for the shares of a setlist:', error)
  }
}

/** Tell the live shares of the setlists with this song in them that it changed */
export async function notifySongShares(env: Env, songUuid: string): Promise<void> {
  if (!env.DB || !env.SHARE_ROOM) return
  try {
    await ring(env, await sharesOfSong(env.DB, songUuid))
  } catch (error) {
    console.warn('[Share] Could not look for the shares of a song:', error)
  }
}
