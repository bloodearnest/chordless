/**
 * How this device reaches the Worker, and where a space's pad sets are kept on Chordless (docs/STORAGE_API.md).
 */
import type { Space } from '../data-types.ts'
import { getIdentityToken } from '../google-auth.ts'
import type { WorkerConnection } from '../worker-call.ts'
import { LibraryPads } from './library-pads.ts'
import type { PadStorage } from './types.ts'

/** The signed-in person's connection to the Worker (`window.fetch` is read at each call, so a test that replaces it is heard) */
export const workerConnection = (): WorkerConnection => ({
  token: getIdentityToken,
  origin: window.location.origin,
  fetch: (input, init) => window.fetch(input, init),
})

/** Whether the space is a team the person is a member of, not the owner */
export function isTeamMember(space: Pick<Space, 'team'> | null | undefined): boolean {
  return Boolean(space?.team && space.team.role !== 'owner')
}

/**
 * The pad sets of a space on Chordless, in a library on the server: a moved Personal space's own, or the library of a
 * church team's church (the same for each of its teams)
 */
export function serverPadsFor(space: Pick<Space, 'server' | 'team'>): PadStorage | null {
  if (space.server) return new LibraryPads(workerConnection(), { library: space.server.libraryId })
  if (space.team?.churchId) return new LibraryPads(workerConnection(), { team: space.team.id })
  return null
}
