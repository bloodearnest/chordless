/**
 * Syncing a space from the Account and Teams page: any space on this device, not only the one in
 * use (docs/ACCOUNT.md), and notes when it last synced.
 */
import type { Space } from './data-types.ts'
import { isAuthenticated } from './google-auth.ts'
import { recordSync } from './last-sync.ts'
import { t } from './text.ts'
import { UserError } from './utils/errors.ts'

/**
 * Sync the space with Chordless (a Personal space still linked to a Drive folder moves there first, and Drive is never
 * synced again).
 * @returns when it finished (ISO time)
 * @throws the sync's error, for the caller to tell the person
 */
/* v8 ignore next 6 -- wiring to the server sync of the space, which the Playwright tests run */
export async function syncSpaceNow(space: Space): Promise<string> {
  if (!(await isAuthenticated())) throw new UserError(t('space-sync-sign-in'))
  const { syncSpaceDataFor } = await import('./space-data-runtime.ts')
  await syncSpaceDataFor(space.id, { all: true })
  return recordSync(space.id)
}
