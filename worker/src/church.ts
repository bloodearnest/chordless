/** Church creation and settings. Existing Drive-backed spaces are not switched here. */
import { ulid } from '../../src/js/ulid.ts'
import type { Env } from './env.ts'
import { isRecord, jsonResponse, Refusal, readJson, refusing } from './http.ts'
import { authenticate, SESSION_PROVIDER, sessionProvider } from './identity.ts'

export const CHURCHES_PATH = '/api/churches'
export const isChurchPath = (path: string) =>
  path === CHURCHES_PATH || /^\/api\/churches\/[A-Za-z0-9_-]+$/.test(path)

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
    const id = new URL(request.url).pathname.slice(CHURCHES_PATH.length + 1)
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
