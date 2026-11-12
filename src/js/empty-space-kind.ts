/**
 * What a space with no setlists is, for the home page to say (components/empty-space.ts):
 * - `syncing`: one never fetched, being fetched now (the files of a team just set up on this device)
 * - `not-synced`: one in Google Drive, or a team's, never fetched, with nothing fetching it
 * - `empty`: one that has been fetched, or a team's, and has no setlists
 * - `first-use`: a space of a person who has not got going yet: nothing in Drive, never synced
 * Only the last is a new user's welcome; a team is not new because it has nothing yet.
 */
import type { Space } from './data-types.ts'
import { lastSyncOf } from './last-sync.ts'
import { syncRunning } from './sync-status.ts'

export type EmptySpaceKind = 'syncing' | 'not-synced' | 'empty' | 'first-use'

export function emptySpaceKind(space: Space): EmptySpaceKind {
  const fetched = Boolean(lastSyncOf(space.id))
  if (!fetched && syncRunning(space.id)) return 'syncing'
  if (!fetched && (space.team || space.rootRef)) return 'not-synced'
  if (fetched || space.team) return 'empty'
  return 'first-use'
}
