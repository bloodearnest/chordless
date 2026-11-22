/** Authenticated church administration and invitation calls. */
import { getIdentityToken } from './google-auth.ts'
import type { MemberRole } from './team-roles.ts'
import { callWorker, type WorkerCall } from './worker-call.ts'

/** Team membership or following choices may have changed. */
export class ChurchTeamsChangedEvent extends Event {
  static readonly type = 'church-teams:changed'
  constructor() {
    super(ChurchTeamsChangedEvent.type)
  }
}

export interface ChurchInfo {
  id: string
  name: string
  country: string
  city: string
  postcode: string | null
  ccliLicence: string | null
  licences: Record<string, unknown>
  role: MemberRole
}
export interface ChurchTeam {
  id: string
  name: string
  archivedAt: string | null
  followed: number
}
export interface ChurchMember {
  id: string
  name: string | null
  role: MemberRole
  joinedAt: string
}
export type ChurchDetails = Pick<
  ChurchInfo,
  'name' | 'country' | 'city' | 'postcode' | 'ccliLicence' | 'licences'
>

async function call<T>(
  path: string,
  method: WorkerCall['method'] = 'GET',
  body?: unknown
): Promise<T> {
  const response = await callWorker(
    { path, method, body },
    {
      token: getIdentityToken,
      origin: location.origin,
      fetch: (input, init) => window.fetch(input, init),
    }
  )
  return response.status === 204 ? (undefined as T) : response.json()
}
const church = (id: string) => `/api/churches/${encodeURIComponent(id)}`
const team = (id: string, teamId: string) => `${church(id)}/teams/${encodeURIComponent(teamId)}`
export const churchClient = {
  list: () => call<ChurchInfo[]>('/api/churches'),
  matches: (licence: string) =>
    call<Pick<ChurchInfo, 'name' | 'city' | 'country'>[]>(
      `/api/churches/matches?licence=${encodeURIComponent(licence)}`
    ),
  create: (details: ChurchDetails) => call<{ id: string }>('/api/churches', 'POST', details),
  update: (id: string, details: ChurchDetails) => call<{ id: string }>(church(id), 'PUT', details),
  teams: (id: string) => call<ChurchTeam[]>(`${church(id)}/teams`),
  members: (id: string) => call<ChurchMember[]>(`${church(id)}/members`),
  addTeam: (id: string, name: string) =>
    call<{ id: string }>(`${church(id)}/teams`, 'POST', { name }),
  archiveTeam: (id: string, teamId: string) => call<void>(team(id, teamId), 'DELETE'),
  restoreTeam: (id: string, teamId: string) => call<void>(team(id, teamId), 'PUT'),
  follow: (id: string, teamId: string, following: boolean) =>
    call<void>(`${team(id, teamId)}/follow`, following ? 'PUT' : 'DELETE'),
  setRole: (id: string, account: string, role: MemberRole) =>
    call<void>(`${church(id)}/members/${encodeURIComponent(account)}`, 'PUT', { role }),
  removeMember: (id: string, account: string) =>
    call<void>(`${church(id)}/members/${encodeURIComponent(account)}`, 'DELETE'),
  invite: (id: string, teamId: string, email: string, role: MemberRole) =>
    call<{ code: string; expiresAt: string }>(`${team(id, teamId)}/invites`, 'POST', {
      email,
      role,
    }),
  join: (teamId: string, code: string) =>
    call<{ churchId: string; teamId: string }>('/api/church-invites/join', 'POST', {
      teamId,
      code,
    }),
}
