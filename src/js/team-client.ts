/**
 * The Worker's team space routes, as the page calls them (worker/src/team-admin.ts): making a
 * space, joining one with an invite, and looking after its people. Each call carries the signed-in
 * person's Google ID token (`getIdentityToken`); the files themselves go through `TeamStorage`.
 */
import { getIdentityToken } from './google-auth.ts'
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

const space = (id: string) => `/api/space/${encodeURIComponent(id)}`

export const teamApi = {
  /** Share a folder you own as a team space; `blob` is the page's own sign-in */
  createSpace: (details: { blob: string; rootRef: string; name: string }) =>
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
  leave: (id: string) => call<void>('POST', `${space(id)}/leave`),

  /** The owner's new sign-in, when Google no longer honours the one the space holds */
  replaceCredential: (id: string, blob: string) =>
    call<void>('PUT', `${space(id)}/credential`, { blob }),
  /** End sharing: the Worker forgets the space; the Drive folder and its files stay */
  endSharing: (id: string) => call<void>('DELETE', space(id)),
}
