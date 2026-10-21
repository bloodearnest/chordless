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
  handleSpaceAdmin,
  isAdminRoute,
  SPACE_ID,
} from './team-admin.ts'
import { handleTeamRequest, teamSpacePath } from './team-api.ts'
import { createAdminContext, createTeamContext, type TeamDeps } from './team-context.ts'

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
  if (!env.TEAM_SPACE) return jsonResponse({ error: 'Team spaces are not available' }, 503)
  const spaces = env.TEAM_SPACE
  const path = new URL(request.url).pathname
  const admin = createAdminContext(env, spaces, deps)

  const answer = await (async () => {
    if (path === '/api/spaces') {
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

    if (isAdminRoute(request.method, team.rest)) {
      const identity = await admin.identify(request)
      if (!identity) return jsonResponse({ error: 'Sign in first' }, 401)
      const role = await admin.room(team.spaceId).roleOf(identity)
      if (!role) return jsonResponse({ error: 'Not a member of this space' }, 403)
      return handleSpaceAdmin(request, team, admin, { identity, role })
    }
    return handleTeamRequest(request, team, createTeamContext(env, spaces, deps))
  })()

  // (a member's files, and the codes of invites, are not kept by anything on the way)
  const headers = new Headers(answer.headers)
  headers.set('Cache-Control', 'no-store')
  return new Response(answer.body, { status: answer.status, headers })
}
