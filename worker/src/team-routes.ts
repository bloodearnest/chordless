/**
 * The team space routes the router hands over (team-api.ts for the files, team-admin.ts for the
 * space itself): `/api/spaces...` and `/api/space/<id>...`. Who is asking is settled first, and
 * nothing is kept by anything on the way.
 */
import type { Env } from './env.ts'
import { jsonResponse } from './http.ts'
import {
  handleCreateSpace,
  handleJoin,
  handleListSpaces,
  handleSpaceAdmin,
  isAdminRoute,
  SPACE_ID,
} from './team-admin.ts'
import { handleTeamRequest, refusal, teamSpacePath } from './team-api.ts'
import { createAdminContext, createTeamContext, type TeamDeps } from './team-context.ts'
import { handleLive, livePathSpace } from './team-live.ts'

/** Whether a path is one of these routes */
export function isTeamPath(path: string): boolean {
  return path === '/api/spaces' || path === '/api/spaces/join' || teamSpacePath(path) !== null
}

/** The answer for a team space path, as the router passes it (`isTeamPath` said yes) */
export async function handleTeamRoutes(
  request: Request,
  env: Env,
  deps?: TeamDeps
): Promise<Response> {
  if (!env.DB) return jsonResponse({ error: 'Team spaces are not available' }, 503)
  const path = new URL(request.url).pathname
  const admin = createAdminContext(env, deps)

  // A device going live: the answer carries a socket, which the wrapper below would drop
  const liveSpace = livePathSpace(path)
  if (liveSpace !== null) return handleLive(request, liveSpace, admin)

  const answer = await (async () => {
    if (path === '/api/spaces') {
      if (request.method === 'GET') return handleListSpaces(request, admin)
      return request.method === 'POST'
        ? handleCreateSpace(request, admin)
        : jsonResponse({ error: 'Not found' }, 404)
    }
    if (path === '/api/spaces/join') {
      return request.method === 'POST'
        ? handleJoin(request, admin)
        : jsonResponse({ error: 'Not found' }, 404)
    }

    const team = teamSpacePath(path)
    // (an id is made by the Worker, so anything else is not one: no object is made for it)
    if (!team || !SPACE_ID.test(team.spaceId)) return jsonResponse({ error: 'No such space' }, 404)

    // Who is asking, and their role in the space: settled before anything else is looked at. The
    // ID token is checked before the database is touched, so only signed-in accounts can
    // ask for one; a stranger and a space that is not there get the same answer
    // (docs/SECURITY.md, "Probing for team spaces")
    const identity = await admin.identify(request)
    if (!identity) return refusal('unauthenticated')
    const role = await admin.room(team.spaceId).roleOf(identity)
    if (!role) return refusal('not-a-member')

    if (isAdminRoute(team.rest)) return handleSpaceAdmin(request, team, admin, { identity, role })
    return handleTeamRequest(request, team, createTeamContext(env, deps), role, identity)
  })()

  // (a member's files, and the codes of invites, are not kept by anything on the way)
  const headers = new Headers(answer.headers)
  headers.set('Cache-Control', 'no-store')
  return new Response(answer.body, { status: answer.status, headers })
}
