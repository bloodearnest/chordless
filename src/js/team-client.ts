/**
 * The Worker's team space routes, as the page calls them (worker/src/team-admin.ts): making a
 * space, joining one with an invite, and looking after its people. Each call carries the signed-in
 * person's Google ID token (`getIdentityToken`); the files themselves go through `TeamStorage`.
 */

import type { TeamLicence } from './ccli-licence.ts'
import type { Person } from './data-types.ts'
import { getIdentityToken } from './google-auth.ts'
import type { StoredFile } from './storage/types.ts'
import type { InviteInfo, MemberRole, TeamMember, TeamRole } from './team-roles.ts'
import { callWorker, type WorkerCall } from './worker-call.ts'

async function call<T>(method: WorkerCall['method'], path: string, body?: unknown): Promise<T> {
  const response = await callWorker(
    { method, path, body },
    {
      token: getIdentityToken,
      origin: location.origin,
      fetch: (input, init) => window.fetch(input, init),
    }
  )
  return response.status === 204 ? (undefined as T) : response.json()
}

/** How the Worker reaches a team space's folder (docs/SPACES.md, "Credentials") */
export interface TeamCredential {
  kind: 'owner' | 'service-account'
  /** The address a team adds to its shared drive; null where the server has no team storage */
  serviceAccount: string | null
}

const space = (id: string) => `/api/space/${encodeURIComponent(id)}`

export const teamApi = {
  /** Share a folder you own as a team space; `blob` is the page's own sign-in */
  createSpace: (details: { blob: string; rootRef: string; name: string; ccliLicence?: string }) =>
    call<{ spaceId: string; role: TeamRole }>('POST', '/api/spaces', details),

  /** Join a space with the code from an invite sent to your Google address */
  join: (spaceId: string, code: string) =>
    call<{ spaceId: string; role: TeamRole }>('POST', '/api/spaces/join', { spaceId, code }),

  members: (id: string) => call<TeamMember[]>('GET', `${space(id)}/members`),
  invites: (id: string) => call<InviteInfo[]>('GET', `${space(id)}/invites`),
  createInvite: (id: string, role: MemberRole, email: string) =>
    call<{ code: string; expiresAt: string }>('POST', `${space(id)}/invites`, { role, email }),
  revokeInvite: (id: string, inviteId: string) =>
    call<void>('DELETE', `${space(id)}/invites/${encodeURIComponent(inviteId)}`),

  setRole: (id: string, email: string, role: MemberRole) =>
    call<void>('PUT', `${space(id)}/members/${encodeURIComponent(email)}`, { role }),
  removeMember: (id: string, email: string) =>
    call<void>('DELETE', `${space(id)}/members/${encodeURIComponent(email)}`),
  /**
   * The name of the person who is you in a space, whatever your role (a team member cannot change
   * files, but may name themselves): the Worker checks the person has your verified email. It
   * answers with the file as written and the person as now stored.
   */
  nameSelf: (id: string, personId: string, name: string) =>
    call<{ file: StoredFile; person: Person }>(
      'PUT',
      `${space(id)}/people/${encodeURIComponent(personId)}/name`,
      { name }
    ),
  leave: (id: string) => call<void>('POST', `${space(id)}/leave`),

  /** The owner's new sign-in, when Google no longer honours the one the space holds */
  replaceCredential: (id: string, blob: string) =>
    call<void>('PUT', `${space(id)}/credential`, { blob }),
  /**
   * How the Worker reaches the space's folder: the owner's sign-in, or team-managed storage
   * (Chordless's service account), whose address is given where the server has one
   */
  credential: (id: string) => call<TeamCredential>('GET', `${space(id)}/credential`),
  /** Check that team storage can keep the folder's files, and use it (the owner's sign-in is then forgotten) */
  useTeamStorage: (id: string) =>
    call<TeamCredential>('POST', `${space(id)}/credential/service-account`),
  /**
   * The team's CCLI licence number, which the Worker keeps with the team for its records; an admin
   * also gets the log of its changes (docs/SPACES.md, "SongSelect's terms")
   */
  licence: (id: string) => call<TeamLicence>('GET', `${space(id)}/licence`),
  /** Set it (empty to clear it): a writer may set it where there is none; changing it takes an admin */
  setLicence: (id: string, ccliLicence: string) =>
    call<TeamLicence>('PUT', `${space(id)}/licence`, { ccliLicence }),
  /** End sharing: the Worker forgets the space; the Drive folder and its files stay */
  endSharing: (id: string) => call<void>('DELETE', space(id)),
}
