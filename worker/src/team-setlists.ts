/** Church team setlists: the same versioned changes used by the offline sync engine. */
import type { SpaceOp, SpaceOpResult, SpaceSetlist } from '../../src/js/space-data-types.ts'
import { sha256Hex } from '../../src/js/utils/bytes.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import { isRecord, jsonResponse, Refusal, readJson, refusing } from './http.ts'
import { authenticate, SESSION_PROVIDER, sessionProvider } from './identity.ts'
import { Invalid, parseSetlist } from './space-data.ts'

const PATH = /^\/api\/teams\/([A-Za-z0-9_-]+)\/(data|batch)$/
const ID = /^[A-Za-z0-9_-]{1,64}$/
export const isTeamSetlistPath = (path: string) => PATH.test(path)

interface TeamAccess {
  church: string
  library: string
  role: string
  archived: string | null
}
interface Row {
  setlist_id: string
  date: string
  time: string
  type: string
  name: string
  leader_id: string | null
  created_by: string | null
  created_at: string
  body: string
  songs: string
  version: number
  modified_at: string
}
function fromRow(row: Row): SpaceSetlist {
  return {
    setlistId: row.setlist_id,
    date: row.date,
    time: row.time,
    type: row.type,
    name: row.name,
    leaderId: row.leader_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    body: JSON.parse(row.body),
    songs: JSON.parse(row.songs),
    version: row.version,
    modifiedAt: row.modified_at,
  }
}
async function current(
  db: D1Db,
  team: string,
  id: string,
  account: string
): Promise<SpaceSetlist | null> {
  const row = await db
    .prepare(`SELECT s.* FROM team_setlists s JOIN teams t ON t.space_id = s.space_id
      JOIN churches c ON c.church_id = t.church_id JOIN church_members m ON m.church_id = c.church_id
      WHERE s.space_id = ? AND s.setlist_id = ? AND m.account_id = ? AND c.ended_at IS NULL`)
    .bind(team, id, account)
    .first<Row>()
  return row ? fromRow(row) : null
}

async function canStillWrite(db: D1Db, team: string, account: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS allowed FROM teams t JOIN churches c ON c.church_id = t.church_id
    JOIN church_members m ON m.church_id = c.church_id WHERE t.space_id = ? AND t.ended_at IS NULL
    AND c.ended_at IS NULL AND m.account_id = ? AND m.role IN ('writer', 'admin')`)
    .bind(team, account)
    .first()
  return Boolean(row)
}

/** Every request verifies active church membership; the write repeats the check atomically. */
export function handleTeamSetlists(request: Request, env: Env): Promise<Response> {
  return refusing(async () => {
    if (!env.DB) throw new Refusal(503, 'Teams are not available')
    const identity = await authenticate(request, [sessionProvider(env)])
    if (!identity || identity.provider !== SESSION_PROVIDER) throw new Refusal(401, 'Sign in first')
    const match = PATH.exec(new URL(request.url).pathname)
    if (!match) throw new Refusal(404, 'Not found')
    const [, team, resource] = match
    const db = env.DB
    const access = await db
      .prepare(`SELECT c.church_id AS church, l.library_id AS library, m.role, t.ended_at AS archived
      FROM teams t JOIN churches c ON c.church_id = t.church_id
      JOIN libraries l ON l.church_id = c.church_id JOIN church_members m ON m.church_id = c.church_id
      WHERE t.space_id = ? AND m.account_id = ? AND c.ended_at IS NULL`)
      .bind(team, identity.sub)
      .first<TeamAccess>()
    if (!access) throw new Refusal(404, 'No such team')
    if (resource === 'data' && request.method === 'GET') {
      const { results } = await db
        .prepare('SELECT * FROM team_setlists WHERE space_id = ? ORDER BY date, setlist_id')
        .bind(team)
        .all<Row>()
      const people = await db
        .prepare(`SELECT a.account_id AS id, a.name, a.created_at, m.joined_at, m.role
        FROM accounts a LEFT JOIN church_members m ON m.account_id = a.account_id AND m.church_id = ?
        WHERE m.account_id IS NOT NULL OR a.account_id IN (SELECT leader_id FROM team_setlists WHERE space_id = ? AND leader_id IS NOT NULL)
        ORDER BY a.account_id`)
        .bind(access.church, team)
        .all<{
          id: string
          name: string | null
          created_at: string
          joined_at: string | null
          role: string | null
        }>()
      const data = {
        setlists: results.map(fromRow),
        songs: [],
        people: people.results.map(person => ({
          personId: person.id,
          name: person.name || (person.id === identity.sub ? identity.email : person.id),
          emails: person.id === identity.sub ? [identity.email.toLowerCase()] : [],
          teamMember: `chordless:${person.id}`,
          mergedInto: null,
          version: 1,
          modifiedAt: person.joined_at ?? person.created_at,
          leaderEligible: person.role === 'writer' || person.role === 'admin',
        })),
        padSets: [],
        from: null,
      }
      const etag = `"${await sha256Hex(JSON.stringify(data))}"`
      const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' }
      if (request.headers.get('If-None-Match') === etag)
        return new Response(null, { status: 304, headers })
      return Response.json(data, { headers })
    }
    if (resource === 'batch' && request.method === 'POST') {
      const body = await readJson(request)
      if (!Array.isArray(body.ops) || body.ops.length > 100) throw new Refusal(400, 'Invalid batch')
      const results: SpaceOpResult[] = []
      for (const op of body.ops)
        results.push(await applyTeamSetlist(db, team, access, identity.sub, op))
      return jsonResponse({ results })
    }
    throw new Refusal(404, 'Not found')
  })
}

/** SQL predicates repeat access, song ownership and leader eligibility at the point of writing. */
export async function applyTeamSetlist(
  db: D1Db,
  team: string,
  access: TeamAccess,
  account: string,
  value: unknown
): Promise<SpaceOpResult> {
  if (
    !isRecord(value) ||
    value.kind !== 'setlist' ||
    typeof value.id !== 'string' ||
    !ID.test(value.id)
  )
    return { status: 'invalid', error: 'Not a setlist or an id' }
  const op = value as unknown as SpaceOp
  if (access.role === 'reader' || access.archived)
    return {
      status: 'forbidden',
      error: 'Only a worship leader or admin can change an active team',
    }
  const base = op.baseVersion
  if (op.op === 'delete') {
    if (base !== undefined && base !== null && (!Number.isInteger(base) || base < 1))
      return { status: 'invalid', error: 'Invalid version' }
    const result = await db
      .prepare(`DELETE FROM team_setlists WHERE space_id = ? AND setlist_id = ? AND (? IS NULL OR version = ?)
      AND EXISTS (SELECT 1 FROM teams t JOIN churches c ON c.church_id = t.church_id JOIN church_members m ON m.church_id = c.church_id
      WHERE t.space_id = ? AND t.ended_at IS NULL AND c.ended_at IS NULL AND m.account_id = ? AND m.role IN ('writer', 'admin'))`)
      .bind(team, op.id, base ?? null, base ?? null, team, account)
      .run()
    if (result.meta.changes) return { status: 'ok', version: 0 }
    if (!(await canStillWrite(db, team, account)))
      return { status: 'forbidden', error: 'Access changed' }
    const row = await current(db, team, op.id, account)
    return row ? { status: 'conflict', current: row } : { status: 'ok', version: 0 }
  }
  if (op.op !== 'put' || (base !== null && (!Number.isInteger(base) || (base as number) < 1)))
    return { status: 'invalid', error: 'A write needs a base version' }
  let record: ReturnType<typeof parseSetlist>
  try {
    record = parseSetlist(op.record, op.id)
  } catch (error) {
    if (error instanceof Invalid) return { status: 'invalid', error: error.message }
    throw error
  }
  const songs = JSON.stringify(record.songs)
  const values = [
    record.date,
    record.time,
    record.type,
    record.name,
    record.leaderId,
    record.createdBy,
    record.createdAt,
    JSON.stringify(record.body),
    songs,
  ]
  const now = new Date().toISOString()
  const eligible = `EXISTS (SELECT 1 FROM teams t JOIN churches c ON c.church_id = t.church_id JOIN church_members m ON m.church_id = c.church_id
    WHERE t.space_id = ? AND t.church_id = ? AND t.ended_at IS NULL AND c.ended_at IS NULL AND m.account_id = ? AND m.role IN ('writer','admin'))`
  const sameLibrary = `NOT EXISTS (SELECT 1 FROM json_each(?) s WHERE NOT EXISTS (SELECT 1 FROM library_songs ls WHERE ls.library_id = ? AND ls.song_uuid = json_extract(s.value, '$.songUuid')))`
  const leader = `(? IS NULL OR EXISTS (SELECT 1 FROM church_members WHERE church_id = ? AND account_id = ? AND role IN ('writer','admin')) OR EXISTS (SELECT 1 FROM team_setlists WHERE space_id = ? AND setlist_id = ? AND leader_id = ?))`
  try {
    const result =
      base === null
        ? await db
            .prepare(`INSERT INTO team_setlists (space_id, setlist_id, date, time, type, name, leader_id, created_by, created_at, body, songs, version, modified_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ? WHERE ${eligible} AND ${sameLibrary} AND ${leader}`)
            .bind(
              team,
              op.id,
              ...values,
              now,
              team,
              access.church,
              account,
              songs,
              access.library,
              record.leaderId,
              access.church,
              record.leaderId,
              team,
              op.id,
              record.leaderId
            )
            .run()
        : await db
            .prepare(`UPDATE team_setlists SET date = ?, time = ?, type = ?, name = ?, leader_id = ?, created_by = ?, created_at = ?, body = ?, songs = ?, version = version + 1, modified_at = ?
          WHERE space_id = ? AND setlist_id = ? AND version = ? AND ${eligible} AND ${sameLibrary} AND ${leader}`)
            .bind(
              ...values,
              now,
              team,
              op.id,
              base,
              team,
              access.church,
              account,
              songs,
              access.library,
              record.leaderId,
              access.church,
              record.leaderId,
              team,
              op.id,
              record.leaderId
            )
            .run()
    if (result.meta.changes)
      return { status: 'ok', version: base === null ? 1 : (base as number) + 1 }
  } catch (error) {
    /* v8 ignore next -- an unexpected database failure must propagate to the Worker error handler */
    if (!/UNIQUE constraint failed|PRIMARY KEY/i.test(String(error))) throw error
    /* v8 ignore next 2 -- a concurrent membership removal after a uniqueness failure */
    if (!(await canStillWrite(db, team, account)))
      return { status: 'forbidden', error: 'Access changed' }
    return { status: 'conflict', current: await current(db, team, op.id, account) }
  }
  if (!(await canStillWrite(db, team, account)))
    return { status: 'forbidden', error: 'Access changed' }
  const existing = await current(db, team, op.id, account)
  if (existing && (base === null || existing.version !== base))
    return { status: 'conflict', current: existing }
  if (!existing && base !== null) return { status: 'missing' }
  return { status: 'invalid', error: 'The leader or song is not in this church, or access changed' }
}
