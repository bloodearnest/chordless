/** Church creation and settings. Existing Drive-backed spaces are not switched here. */
import { toBase64Url } from '../../src/js/base64url.ts'
import { ulid } from '../../src/js/ulid.ts'
import { sha256Hex } from '../../src/js/utils/bytes.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import { isRecord, jsonResponse, Refusal, readJson, refusing } from './http.ts'
import { authenticate, type Identity, SESSION_PROVIDER, sessionProvider } from './identity.ts'

export const CHURCHES_PATH = '/api/churches'
export const isChurchPath = (path: string) =>
  path === CHURCHES_PATH ||
  path === '/api/church-invites/join' ||
  /^\/api\/churches\/[A-Za-z0-9_-]+\/teams\/[A-Za-z0-9_-]+\/(?:invites|follow)$/.test(path) ||
  /^\/api\/churches\/[A-Za-z0-9_-]+(?:\/(?:members|teams)(?:\/[A-Za-z0-9_-]+)?)?$/.test(path)

function field(value: unknown, name: string, optional = false): string | null {
  if (optional && (value === null || value === undefined || value === '')) return null
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > 200 ||
    /\p{Cc}/u.test(value)
  )
    throw new Refusal(400, `Invalid ${name}`)
  return value.trim()
}

export function handleChurch(request: Request, env: Env): Promise<Response> {
  const response = refusing(async () => {
    if (!env.DB) throw new Refusal(503, 'Churches are not available')
    const identity = await authenticate(request, [sessionProvider(env)])
    if (!identity || identity.provider !== SESSION_PROVIDER) throw new Refusal(401, 'Sign in first')
    const db = env.DB
    if (new URL(request.url).pathname === '/api/church-invites/join')
      return joinChurch(request, db, identity)
    const [id, resource, memberId, subresource] = new URL(request.url).pathname
      .slice(CHURCHES_PATH.length + 1)
      .split('/')
    if (id === 'matches' && request.method === 'GET') {
      const licence = field(new URL(request.url).searchParams.get('licence'), 'CCLI licence')
      const { results } = await db
        .prepare(
          'SELECT name, city, country FROM churches WHERE ccli_licence = ? AND ended_at IS NULL ORDER BY name LIMIT 10'
        )
        .bind(licence)
        .all()
      return jsonResponse(results)
    }
    if (resource === 'members') return manageMembers(request, db, id, memberId, identity.sub)
    if (resource === 'teams' && subresource === 'follow')
      return followTeam(request, db, id, memberId, identity.sub)
    if (resource === 'teams' && subresource === 'invites')
      return createInvite(request, db, id, memberId, identity)
    if (resource === 'teams') return manageTeams(request, db, id, memberId, identity)
    if (!id && request.method === 'GET') {
      const { results } = await db
        .prepare(
          'SELECT c.church_id AS id, c.name, c.country, c.city, c.postcode, c.ccli_licence AS ccliLicence, c.licences, m.role FROM churches c JOIN church_members m ON m.church_id = c.church_id WHERE m.account_id = ? AND c.ended_at IS NULL ORDER BY c.name, c.church_id'
        )
        .bind(identity.sub)
        .all<{ licences: string }>()
      return jsonResponse(results.map(row => ({ ...row, licences: JSON.parse(row.licences) })))
    }
    if (id && request.method === 'GET') {
      const row = await db
        .prepare(
          'SELECT c.church_id AS id, c.name, c.country, c.city, c.postcode, c.ccli_licence AS ccliLicence, c.licences, m.role FROM churches c JOIN church_members m ON m.church_id = c.church_id WHERE c.church_id = ? AND m.account_id = ? AND c.ended_at IS NULL'
        )
        .bind(id, identity.sub)
        .first<{ licences: string }>()
      if (!row) throw new Refusal(404, 'No such church')
      return jsonResponse({ ...row, licences: JSON.parse(row.licences) })
    }
    if ((!id && request.method === 'POST') || (id && request.method === 'PUT')) {
      if (id) {
        const member = await db
          .prepare(
            'SELECT m.role FROM church_members m JOIN churches c ON c.church_id = m.church_id WHERE m.church_id = ? AND m.account_id = ? AND c.ended_at IS NULL'
          )
          .bind(id, identity.sub)
          .first<{ role: string }>()
        if (!member) throw new Refusal(404, 'No such church')
        if (member.role !== 'admin')
          throw new Refusal(403, 'Only an admin can change church settings')
      }
      const body = await readJson(request)
      const name = field(body.name, 'name')
      const country = field(body.country, 'country')
      const city = field(body.city, 'city')
      const postcode = field(body.postcode, 'postcode', true)
      const licence = field(body.ccliLicence, 'CCLI licence', true)
      const licences = body.licences ?? {}
      if (!isRecord(licences) || JSON.stringify(licences).length > 65536)
        throw new Refusal(400, 'Invalid licences')
      const now = new Date().toISOString()
      if (id) {
        const changed = await db
          .prepare(
            "UPDATE churches SET name = ?, country = ?, city = ?, postcode = ?, ccli_licence = ?, licences = ?, updated_at = ? WHERE church_id = ? AND ended_at IS NULL AND EXISTS (SELECT 1 FROM church_members WHERE church_id = ? AND account_id = ? AND role = 'admin')"
          )
          .bind(
            name,
            country,
            city,
            postcode,
            licence,
            JSON.stringify(licences),
            now,
            id,
            id,
            identity.sub
          )
          .run()
        if (!changed.meta.changes)
          throw new Refusal(403, 'Only an admin can change church settings')
        return jsonResponse({ id })
      }
      const church = ulid()
      const library = ulid()
      const firstTeam = ulid()
      await db.batch([
        db
          .prepare(
            'INSERT INTO churches (church_id, name, country, city, postcode, ccli_licence, licences, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .bind(church, name, country, city, postcode, licence, JSON.stringify(licences), now, now),
        db
          .prepare('INSERT INTO libraries (library_id, church_id, created_at) VALUES (?, ?, ?)')
          .bind(library, church, now),
        db
          .prepare(
            "INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES (?, ?, 'admin', ?)"
          )
          .bind(church, identity.sub, now),
        db
          .prepare(
            'INSERT INTO teams (space_id, name, owner_account_id, owner_email, owner_provider, owner_sub, created_at, updated_at, church_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .bind(
            firstTeam,
            name,
            identity.sub,
            identity.email.toLowerCase(),
            identity.provider,
            identity.sub,
            now,
            now,
            church
          ),
        db
          .prepare('INSERT INTO followed_teams (account_id, space_id) VALUES (?, ?)')
          .bind(identity.sub, firstTeam),
      ])
      return jsonResponse({ id: church }, 201)
    }
    throw new Refusal(404, 'Not found')
  })
  return response.then(answer => {
    const headers = new Headers(answer.headers)
    headers.set('Cache-Control', 'no-store')
    return new Response(answer.body, { status: answer.status, headers })
  })
}

/** Church-wide membership; the last active admin cannot remove or demote themselves. */
async function manageMembers(
  request: Request,
  db: D1Db,
  church: string,
  target: string | undefined,
  account: string
): Promise<Response> {
  const actor = await db
    .prepare(
      'SELECT m.role FROM church_members m JOIN churches c ON c.church_id = m.church_id WHERE m.church_id = ? AND m.account_id = ? AND c.ended_at IS NULL'
    )
    .bind(church, account)
    .first<{ role: string }>()
  if (!actor) throw new Refusal(404, 'No such church')
  if (!target && request.method === 'GET') {
    const { results } = await db
      .prepare(
        'SELECT m.account_id AS id, a.name, m.role, m.joined_at AS joinedAt FROM church_members m JOIN accounts a ON a.account_id = m.account_id WHERE m.church_id = ? ORDER BY a.name, m.account_id'
      )
      .bind(church)
      .all()
    return jsonResponse(results)
  }
  if (!target || !['PUT', 'DELETE'].includes(request.method)) throw new Refusal(404, 'Not found')
  if (actor.role !== 'admin') throw new Refusal(403, 'Only an admin can manage members')
  const existing = await db
    .prepare('SELECT role FROM church_members WHERE church_id = ? AND account_id = ?')
    .bind(church, target)
    .first<{ role: string }>()
  if (!existing) throw new Refusal(404, 'No such member')
  const role = request.method === 'PUT' ? (await readJson(request)).role : null
  if (request.method === 'PUT' && !['admin', 'writer', 'reader'].includes(String(role)))
    throw new Refusal(400, 'Invalid role')
  const safeguard =
    " AND EXISTS (SELECT 1 FROM church_members a JOIN churches c ON c.church_id = a.church_id WHERE a.church_id = ? AND a.account_id = ? AND a.role = 'admin' AND c.ended_at IS NULL) AND (role <> 'admin' OR ? = 'admin' OR EXISTS (SELECT 1 FROM church_members other WHERE other.church_id = ? AND other.role = 'admin' AND other.account_id <> ?))"
  const mutation =
    request.method === 'DELETE'
      ? db
          .prepare(`DELETE FROM church_members WHERE church_id = ? AND account_id = ?${safeguard}`)
          .bind(church, target, church, account, null, church, target)
      : db
          .prepare(
            `UPDATE church_members SET role = ? WHERE church_id = ? AND account_id = ?${safeguard}`
          )
          .bind(role, church, target, church, account, role, church, target)
  const result =
    request.method === 'DELETE'
      ? (
          await db.batch([
            mutation,
            db
              .prepare(
                'DELETE FROM followed_teams WHERE account_id = ? AND space_id IN (SELECT space_id FROM teams WHERE church_id = ?) AND NOT EXISTS (SELECT 1 FROM church_members WHERE church_id = ? AND account_id = ?)'
              )
              .bind(target, church, church, target),
          ])
        )[0]
      : await mutation.run()
  if (!result.meta.changes) throw new Refusal(409, 'The last admin cannot leave or be removed')
  return new Response(null, { status: 204 })
}

/** Teams of a church: everyone reads; admins create, archive and restore. */
async function manageTeams(
  request: Request,
  db: D1Db,
  church: string,
  target: string | undefined,
  identity: Identity
): Promise<Response> {
  const actor = await db
    .prepare(
      'SELECT m.role FROM church_members m JOIN churches c ON c.church_id = m.church_id WHERE m.church_id = ? AND m.account_id = ? AND c.ended_at IS NULL'
    )
    .bind(church, identity.sub)
    .first<{ role: string }>()
  if (!actor) throw new Refusal(404, 'No such church')
  if (!target && request.method === 'GET') {
    const { results } = await db
      .prepare(
        'SELECT t.space_id AS id, t.name, t.ended_at AS archivedAt, EXISTS (SELECT 1 FROM followed_teams f WHERE f.space_id = t.space_id AND f.account_id = ?) AS followed FROM teams t WHERE t.church_id = ? ORDER BY t.name, t.space_id'
      )
      .bind(identity.sub, church)
      .all()
    return jsonResponse(results)
  }
  if (actor.role !== 'admin') throw new Refusal(403, 'Only an admin can manage teams')
  const now = new Date().toISOString()
  if (!target && request.method === 'POST') {
    const name = field((await readJson(request)).name, 'name')
    const id = ulid()
    const result = await db
      .prepare(
        "INSERT INTO teams (space_id, name, owner_account_id, owner_email, owner_provider, owner_sub, created_at, updated_at, church_id) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM church_members m JOIN churches c ON c.church_id = m.church_id WHERE m.church_id = ? AND m.account_id = ? AND m.role = 'admin' AND c.ended_at IS NULL)"
      )
      .bind(
        id,
        name,
        identity.sub,
        identity.email.toLowerCase(),
        identity.provider,
        identity.sub,
        now,
        now,
        church,
        church,
        identity.sub
      )
      .run()
    /* v8 ignore next -- another request can remove the admin after the access check */
    if (!result.meta.changes) throw new Refusal(403, 'Only an admin can manage teams')
    return jsonResponse({ id }, 201)
  }
  if (target && (request.method === 'DELETE' || request.method === 'PUT')) {
    const archived = request.method === 'DELETE' ? now : null
    const result = await db
      .prepare(
        "UPDATE teams SET ended_at = ?, updated_at = ? WHERE space_id = ? AND church_id = ? AND EXISTS (SELECT 1 FROM church_members m JOIN churches c ON c.church_id = m.church_id WHERE m.church_id = ? AND m.account_id = ? AND m.role = 'admin' AND c.ended_at IS NULL)"
      )
      .bind(archived, now, target, church, church, identity.sub)
      .run()
    if (!result.meta.changes) throw new Refusal(404, 'No such team')
    return new Response(null, { status: 204 })
  }
  throw new Refusal(404, 'Not found')
}

/** Create a one-use invite for a church team; the secret itself is never stored. */
async function createInvite(
  request: Request,
  db: D1Db,
  church: string,
  team: string | undefined,
  actor: Identity
): Promise<Response> {
  if (request.method !== 'POST' || !team) throw new Refusal(404, 'Not found')
  const body = await readJson(request)
  const role = body.role
  if (!['admin', 'writer', 'reader'].includes(String(role))) throw new Refusal(400, 'Invalid role')
  const email = field(body.email, 'email')?.toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Refusal(400, 'Invalid email')
  const code = toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
  const hash = await sha256Hex(code)
  const now = new Date()
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const result = await db
    .prepare(
      "INSERT INTO team_invites (space_id, id, email, role, created_by, created_at, expires_at) SELECT t.space_id, ?, ?, ?, ?, ?, ? FROM teams t JOIN churches c ON c.church_id = t.church_id JOIN church_members m ON m.church_id = c.church_id WHERE t.space_id = ? AND t.church_id = ? AND t.ended_at IS NULL AND c.ended_at IS NULL AND m.account_id = ? AND m.role = 'admin'"
    )
    .bind(
      hash,
      email,
      role,
      actor.email.toLowerCase(),
      now.toISOString(),
      expires,
      team,
      church,
      actor.sub
    )
    .run()
  if (!result.meta.changes) throw new Refusal(404, 'No such team')
  return jsonResponse({ code, expiresAt: expires }, 201)
}

/** Redeem atomically: the invitation is consumed once and never changes an existing role. */
async function joinChurch(request: Request, db: D1Db, identity: Identity): Promise<Response> {
  if (request.method !== 'POST') throw new Refusal(404, 'Not found')
  const body = await readJson(request)
  const team = field(body.teamId, 'team')
  const code = field(body.code, 'code')
  /* v8 ignore next -- required fields are either strings or have already raised a refusal */
  if (!team || !code) throw new Refusal(400, 'Invalid invite')
  const hash = await sha256Hex(code)
  const now = new Date().toISOString()
  const invite = await db
    .prepare(
      'SELECT i.role, i.email, t.church_id FROM team_invites i JOIN teams t ON t.space_id = i.space_id JOIN churches c ON c.church_id = t.church_id WHERE i.space_id = ? AND i.id = ? AND i.expires_at > ? AND t.ended_at IS NULL AND c.ended_at IS NULL'
    )
    .bind(team, hash, now)
    .first<{ role: string; email: string; church_id: string }>()
  if (!invite) throw new Refusal(404, 'Invalid or expired invitation')
  if (invite.role === 'admin' && invite.email !== identity.email.toLowerCase())
    throw new Refusal(403, 'This admin invitation is for another address')
  const member = await db
    .prepare('SELECT role FROM church_members WHERE church_id = ? AND account_id = ?')
    .bind(invite.church_id, identity.sub)
    .first()
  if (member) return jsonResponse({ churchId: invite.church_id, teamId: team })
  const valid =
    "SELECT t.church_id, ?, i.role, ?, CASE WHEN i.email = ? THEN NULL ELSE i.email END FROM team_invites i JOIN teams t ON t.space_id = i.space_id JOIN churches c ON c.church_id = t.church_id WHERE i.space_id = ? AND i.id = ? AND i.expires_at > ? AND t.ended_at IS NULL AND c.ended_at IS NULL AND (i.role <> 'admin' OR i.email = ?)"
  const results = await db.batch([
    db
      .prepare(
        'INSERT OR IGNORE INTO church_members (church_id, account_id, role, joined_at, invited_as) ' +
          valid
      )
      .bind(
        identity.sub,
        now,
        identity.email.toLowerCase(),
        team,
        hash,
        now,
        identity.email.toLowerCase()
      ),
    db
      .prepare(
        'INSERT OR IGNORE INTO followed_teams (account_id, space_id) SELECT ?, space_id FROM team_invites WHERE space_id = ? AND id = ? AND expires_at > ? AND EXISTS (SELECT 1 FROM church_members WHERE church_id = ? AND account_id = ?)'
      )
      .bind(identity.sub, team, hash, now, invite.church_id, identity.sub),
    db
      .prepare(
        'DELETE FROM team_invites WHERE space_id = ? AND id = ? AND expires_at > ? AND EXISTS (SELECT 1 FROM church_members WHERE church_id = ? AND account_id = ?)'
      )
      .bind(team, hash, now, invite.church_id, identity.sub),
  ])
  /* v8 ignore next 2 -- a concurrent redemption can consume the invite after it was read */
  if (!results[0].meta.changes || !results[2].meta.changes)
    throw new Refusal(409, 'Invitation already used')
  return jsonResponse({ churchId: invite.church_id, teamId: team })
}

/** The signed-in person's account-wide homepage selection. */
async function followTeam(
  request: Request,
  db: D1Db,
  church: string,
  team: string | undefined,
  account: string
): Promise<Response> {
  if (!team || !['PUT', 'DELETE'].includes(request.method)) throw new Refusal(404, 'Not found')
  const allowed = await db
    .prepare(
      'SELECT 1 AS ok FROM teams t JOIN churches c ON c.church_id = t.church_id JOIN church_members m ON m.church_id = c.church_id WHERE t.space_id = ? AND t.church_id = ? AND t.ended_at IS NULL AND c.ended_at IS NULL AND m.account_id = ?'
    )
    .bind(team, church, account)
    .first()
  if (!allowed) throw new Refusal(404, 'No such team')
  if (request.method === 'PUT') {
    await db
      .prepare(
        'INSERT OR IGNORE INTO followed_teams (account_id, space_id) SELECT ?, t.space_id FROM teams t JOIN churches c ON c.church_id = t.church_id JOIN church_members m ON m.church_id = c.church_id WHERE t.space_id = ? AND t.church_id = ? AND t.ended_at IS NULL AND c.ended_at IS NULL AND m.account_id = ?'
      )
      .bind(account, team, church, account)
      .run()
  } else {
    await db
      .prepare('DELETE FROM followed_teams WHERE account_id = ? AND space_id = ?')
      .bind(account, team)
      .run()
  }
  return new Response(null, { status: 204 })
}
