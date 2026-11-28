/**
 * `GET /api/teams/<team>/live` with `Upgrade: websocket`: a device going live joins a church team's live room
 * (live-relay.ts, docs/LIVE_SYNC.md), the same Durable Object a Drive team's was. A team that moved into its church
 * is no longer a Drive team to `/api/space/<team>/live` (team-live.ts, whose role check leaves church teams out), so
 * who may join is the church's to say: a member of the team's church, with their church role (a reader only listens).
 * The Chordless session token comes in the subprotocol, since a browser cannot set `Authorization` on a WebSocket and
 * a URL gets logged; a stranger and a team that is not there get the same answer.
 */
import { LIVE_PROTOCOL } from '../../src/js/live-protocol.ts'
import type { MemberRole, TeamRole } from '../../src/js/team-roles.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import { jsonResponse } from './http.ts'
import { authenticate, SESSION_PROVIDER, sessionProvider } from './identity.ts'
import { type LiveAttachment, tokenFromProtocol } from './live-relay.ts'
import { TeamSpaceState } from './team-state.ts'

const PATH = /^\/api\/teams\/([A-Za-z0-9_-]{1,64})\/live$/

/** The team a church team's live path is for, or null if this is not one */
export function churchLivePath(path: string): string | null {
  return PATH.exec(path)?.[1] ?? null
}

/** The account's role in the church a team is in: none if they are not of it, or the team or the church has ended */
export async function churchTeamRole(
  db: D1Db,
  team: string,
  account: string
): Promise<MemberRole | null> {
  const row = await db
    .prepare(
      `SELECT m.role FROM teams t JOIN churches c ON c.church_id = t.church_id
      JOIN church_members m ON m.church_id = c.church_id
      WHERE t.space_id = ? AND m.account_id = ? AND t.ended_at IS NULL AND c.ended_at IS NULL`
    )
    .bind(team, account)
    .first<{ role: MemberRole }>()
  return row?.role ?? null
}

export async function handleChurchLive(
  request: Request,
  team: string,
  env: Env
): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return jsonResponse({ error: 'This is a live socket' }, 426)
  }
  const token = tokenFromProtocol(request.headers.get('Sec-WebSocket-Protocol'))
  // (the same request, with the token where authenticate looks for it)
  const identity =
    token &&
    (await authenticate(
      new Request(request.url, { headers: { Authorization: `Bearer ${token}` } }),
      [sessionProvider(env)]
    ))
  if (!identity || identity.provider !== SESSION_PROVIDER)
    return jsonResponse({ error: 'Sign in first' }, 401)
  if (!env.DB || !(await churchTeamRole(env.DB as D1Db, team, identity.sub)))
    return jsonResponse({ error: 'No such team' }, 404)
  if (!env.TEAM_ROOM) return jsonResponse({ error: 'No live channel' }, 503)
  const room = env.TEAM_ROOM.get(env.TEAM_ROOM.idFromName(team))
  // (fresh headers: only these reach the object, and a browser's request has no way to set them)
  return room.fetch(
    new Request(request.url, {
      headers: {
        Upgrade: 'websocket',
        'X-Live-Identity': JSON.stringify({
          provider: identity.provider,
          sub: identity.sub,
          spaceId: team,
        }),
        'Sec-WebSocket-Protocol': LIVE_PROTOCOL,
      },
    })
  )
}

/**
 * Who is in a team's live room, asked again for every message: a Drive team's member by their role in it, or, for a
 * church's team (which a Drive team's role leaves out), a member of the church signed in with Chordless, by their
 * church role
 */
export async function roleIn(db: D1Db, who: LiveAttachment): Promise<TeamRole | null> {
  const role = await new TeamSpaceState(db, who.spaceId).roleOf(who)
  if (role || who.provider !== SESSION_PROVIDER) return role
  return churchTeamRole(db, who.spaceId, who.sub)
}
