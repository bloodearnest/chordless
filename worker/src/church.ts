/** Church creation and settings. Existing Drive-backed spaces are not switched here. */
import { ulid } from '../../src/js/ulid.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import { isRecord, jsonResponse, Refusal, readJson, refusing } from './http.ts'
import { authenticate, type Identity, SESSION_PROVIDER, sessionProvider } from './identity.ts'

export const CHURCHES_PATH = '/api/churches'
export const isChurchPath = (path: string) =>
  path === CHURCHES_PATH ||
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
    const [id, resource, memberId] = new URL(request.url).pathname
      .slice(CHURCHES_PATH.length + 1)
      .split('/')
    if (resource === 'members') return manageMembers(request, db, id, memberId, identity.sub)
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
            ulid(),
            name,
            identity.sub,
            identity.email.toLowerCase(),
            identity.provider,
            identity.sub,
            now,
            now,
            church
          ),
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
  const result =
    request.method === 'DELETE'
      ? await db
          .prepare('DELETE FROM church_members WHERE church_id = ? AND account_id = ?' + safeguard)
          .bind(church, target, church, account, null, church, target)
          .run()
      : await db
          .prepare(
            'UPDATE church_members SET role = ? WHERE church_id = ? AND account_id = ?' + safeguard
          )
          .bind(role, church, target, church, account, role, church, target)
          .run()
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
        'SELECT space_id AS id, name, ended_at AS archivedAt FROM teams WHERE church_id = ? ORDER BY name, space_id'
      )
      .bind(church)
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
