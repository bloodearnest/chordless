/**
 * The Worker's team space routes, as the page calls them (worker/src/team-admin.ts): making a
 * space, joining one with an invite, and looking after its people. Each call carries the signed-in
 * person's Google ID token (`getIdentityToken`); the files themselves go through `TeamStorage`.
 */
import type { SpaceMember, TeamRole } from './data-types.ts'
import { getIdentityToken } from './google-auth.ts'

/** An answer from the Worker that was not a success, with its HTTP status */
export class TeamError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'TeamError'
    this.status = status
  }
}

/** A person invited to join, as an admin sees it (the code is shown once, when it is made) */
export interface Invite {
  id: string
  email: string
  role: Exclude<TeamRole, 'owner'>
  createdBy: string
  createdAt: string
  expiresAt: string
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await window.fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${await getIdentityToken()}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const reason = await response
      .json()
      .then((answer: { error?: string }) => answer.error)
      .catch(() => undefined)
    throw new TeamError(reason || `Error ${response.status}`, response.status)
  }
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

  members: (id: string) => call<SpaceMember[]>('GET', `${space(id)}/members`),
  invites: (id: string) => call<Invite[]>('GET', `${space(id)}/invites`),
  createInvite: (id: string, role: Invite['role'], email: string) =>
    call<{ code: string; expiresAt: string }>('POST', `${space(id)}/invites`, { role, email }),
  revokeInvite: (id: string, inviteId: string) =>
    call<void>('DELETE', `${space(id)}/invites/${encodeURIComponent(inviteId)}`),

  setRole: (id: string, email: string, role: Invite['role']) =>
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
