/**
 * Where a space's files are kept, as this device reaches them: straight in Google Drive for a
 * space of its own and for the owner of a team space, and through the Worker for anyone else in a
 * team space (docs/SPACES.md, "Credentials", docs/STORAGE_API.md, "The team backend").
 */
import type { Space } from '../data-types.ts'
import { getIdentityToken } from '../google-auth.ts'
import { driveStorage } from './browser-drive.ts'
import { TeamStorage } from './team-storage.ts'
import type { StorageBackend } from './types.ts'

let team: TeamStorage | undefined

/** The backend for team spaces this person is a member of, not the owner (made once) */
function teamStorage(): TeamStorage {
  // (`window.fetch` is read at each call, so a test that replaces it is heard)
  team ??= new TeamStorage({
    token: getIdentityToken,
    origin: window.location.origin,
    fetch: (input, init) => window.fetch(input, init),
  })
  return team
}

/** Whether the space is a team space whose files this person reaches through the Worker */
export function isTeamMember(space: Pick<Space, 'team'> | null | undefined): boolean {
  return Boolean(space?.team && space.team.role !== 'owner')
}

/** The backend for a space (Google Drive for one that is not a team's, or the owner's) */
export function storageFor(space: Pick<Space, 'team'> | null | undefined): StorageBackend {
  return isTeamMember(space) ? teamStorage() : driveStorage
}
