/**
 * A space's data in D1 (docs/D1_PHASE1_PLAN.md, "Space data and its sync"; migrations/0012_space_data.sql): its songs
 * (the index only), setlists with their songs, people and pad sets, answered whole and written a record at a time.
 * Nothing here is song content: no chart, lyrics or chords (CLAUDE.md, "Spaces and copyright").
 *
 * Everything under `/api/space/<id>/`, for a team whose `storage` is `'d1'` (a team still on Drive answers 409
 * `not_moved`), after team-routes.ts has settled who is asking and their role:
 *
 *   GET    /data[?all=1]               the space's data, with an ETag (304 for If-None-Match). The default holds the
 *                                      setlists dated a year back and later; `all=1` holds every one
 *   PUT    /setlists|songs|people|pad-sets/<id>   {baseVersion, record}: make (baseVersion null) or change a record
 *   DELETE /setlists|songs|people|pad-sets/<id>[?baseVersion=]
 *   POST   /batch                      {ops: [...]}: several of the above, each its own answer
 *   PUT    /people/<id>/name {name}    any member names the person who is them
 *
 * A write names the `version` it was made from. Another write in between is a 409 with the record as it now is, and the
 * device applies its change to that. The check and the write are one batch (D1 undoes a batch if a statement fails), so
 * two writes a moment apart cannot both pass. The rules of who may write what are the ones of the Drive-backed API
 * (team-api.ts): a writer changes setlists, songs and people, deletes a setlist they lead, an admin or the owner any;
 * any member adds a pad set, an admin changes or deletes one.
 */
import type {
  SpaceData,
  SpaceOp,
  SpaceOpResult,
  SpacePadSet,
  SpacePerson,
  SpaceRecordKind,
  SpaceSetlist,
  SpaceSetlistSong,
  SpaceSong,
} from '../../src/js/space-data-types.ts'
import { atLeast, type TeamRole } from '../../src/js/team-roles.ts'
import { sha256Hex } from '../../src/js/utils/bytes.ts'
import type { D1Db, D1Statement } from './d1.ts'
import { answering, isRecord, jsonResponse, Refusal, readJson } from './http.ts'
import type { Identity } from './identity.ts'

/** Who is asking, and what they are in the space */
export interface Actor {
  identity: Identity
  role: TeamRole
}

/** The most changes one batch holds */
const MAX_OPS = 100
/** The most songs one setlist holds, and the most annotations one song of it */
const MAX_SONGS = 300
const MAX_ANNOTATIONS = 100
/** The most JSON a record may carry in a free-form field */
const MAX_JSON = 64 * 1024
/** How many hops of a merged person are followed to the one they became */
const MAX_MERGES = 20

const ID = /^[A-Za-z0-9_-]{1,64}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------------------------------------
// Validation: a record that is not one is refused, with what is wrong

export class Invalid extends Error {}

function text(
  value: unknown,
  what: string,
  max: number,
  options: { empty?: boolean; multiline?: boolean } = {}
): string {
  // (a line break and a tab are text where it is free text; nothing else that does not print is)
  const control = options.multiline ? /[^\P{Cc}\n\r\t]/u : /\p{Cc}/u
  if (typeof value !== 'string' || value.length > max || control.test(value)) {
    throw new Invalid(
      `${what} must be text of up to ${max} characters${options.multiline ? '' : ', on one line'}`
    )
  }
  if (!options.empty && value.trim() === '') throw new Invalid(`${what} cannot be empty`)
  return value
}

function textOrNull(value: unknown, what: string, max: number): string | null {
  return value === null || value === undefined ? null : text(value, what, max, { empty: true })
}

function id(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new Invalid(`${what} is not an id`)
  return value
}

function idOrNull(value: unknown, what: string): string | null {
  return value === null || value === undefined ? null : id(value, what)
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value) || JSON.stringify(value).length > MAX_JSON) {
    throw new Invalid(`${what} must be an object of at most ${MAX_JSON} characters`)
  }
  return value
}

function list(value: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max || JSON.stringify(value).length > MAX_JSON) {
    throw new Invalid(`${what} must be a list of at most ${max}`)
  }
  return value
}

function parseSong(record: unknown, songUuid: string): Omit<SpaceSong, 'version' | 'modifiedAt'> {
  if (!isRecord(record) || id(record.songUuid, 'songUuid') !== songUuid) {
    throw new Invalid('The record is not this song')
  }
  return {
    songUuid,
    songId: text(record.songId, 'songId', 300),
    title: text(record.title, 'title', 300),
    ccli: textOrNull(record.ccli, 'ccli', 40),
    key: textOrNull(record.key, 'key', 20),
    licence: textOrNull(record.licence, 'licence', 40),
    isDefault: record.isDefault === true,
    variantOf: textOrNull(record.variantOf, 'variantOf', 300),
    variantLabel:
      record.variantLabel === undefined
        ? ''
        : text(record.variantLabel, 'variantLabel', 100, { empty: true }),
    contentHash: textOrNull(record.contentHash, 'contentHash', 128),
    fileRef: textOrNull(record.fileRef, 'fileRef', 256),
  }
}

function parseSetlistSong(value: unknown): SpaceSetlistSong {
  if (!isRecord(value)) throw new Invalid('A song of a setlist must be an object')
  const { tempo } = value
  if (
    tempo !== null &&
    tempo !== undefined &&
    (!Number.isInteger(tempo) || (tempo as number) < 0 || (tempo as number) > 1000)
  ) {
    throw new Invalid('tempo must be a whole number of beats a minute, or none')
  }
  return {
    songUuid: id(value.songUuid, 'songUuid'),
    songId: text(value.songId, 'songId', 300),
    title: text(value.title, 'title', 300),
    ccli: textOrNull(value.ccli, 'ccli', 40),
    key: textOrNull(value.key, 'key', 20),
    tempo: (tempo ?? null) as number | null,
    notes:
      value.notes === undefined
        ? ''
        : text(value.notes, 'notes', 4000, { empty: true, multiline: true }),
    annotations:
      value.annotations === undefined
        ? []
        : list(value.annotations, 'annotations', MAX_ANNOTATIONS),
    extra: value.extra === undefined ? {} : object(value.extra, 'extra'),
  }
}

export function parseSetlist(
  record: unknown,
  setlistId: string
): Omit<SpaceSetlist, 'version' | 'modifiedAt'> {
  if (!isRecord(record) || id(record.setlistId, 'setlistId') !== setlistId) {
    throw new Invalid('The record is not this setlist')
  }
  if (typeof record.date !== 'string' || !DATE.test(record.date))
    throw new Invalid('date must be YYYY-MM-DD')
  return {
    setlistId,
    date: record.date,
    time: text(record.time, 'time', 8, { empty: true }),
    type: text(record.type, 'type', 200, { empty: true }),
    name: text(record.name, 'name', 200, { empty: true }),
    leaderId: idOrNull(record.leaderId, 'leaderId'),
    createdBy: textOrNull(record.createdBy, 'createdBy', 254)?.toLowerCase() ?? null,
    createdAt: text(record.createdAt, 'createdAt', 40),
    body: record.body === undefined ? {} : object(record.body, 'body'),
    songs: list(record.songs, 'songs', MAX_SONGS).map(parseSetlistSong),
  }
}

function parsePerson(
  record: unknown,
  personId: string
): Omit<SpacePerson, 'version' | 'modifiedAt'> {
  if (!isRecord(record) || id(record.personId, 'personId') !== personId) {
    throw new Invalid('The record is not this person')
  }
  const emails = list(record.emails ?? [], 'emails', 20).map(each =>
    text(each, 'an email', 254).toLowerCase()
  )
  return {
    personId,
    name: text(record.name, 'name', 100),
    emails: [...new Set(emails)],
    teamMember: textOrNull(record.teamMember, 'teamMember', 200),
    mergedInto: idOrNull(record.mergedInto, 'mergedInto'),
  }
}

function parsePadSet(
  record: unknown,
  padSetId: string
): Omit<SpacePadSet, 'version' | 'modifiedAt'> {
  if (!isRecord(record) || id(record.padSetId, 'padSetId') !== padSetId) {
    throw new Invalid('The record is not this pad set')
  }
  return { padSetId, name: text(record.name, 'name', 100) }
}

// ---------------------------------------------------------------------------------------------------------
// Reading

interface SongRow {
  song_uuid: string
  song_id: string
  title: string
  ccli: string | null
  song_key: string | null
  licence: string | null
  is_default: number
  variant_of: string | null
  variant_label: string
  content_hash: string | null
  file_ref: string | null
  version: number
  modified_at: string
}
interface SetlistRow {
  setlist_id: string
  date: string
  time: string
  type: string
  name: string
  leader_id: string | null
  created_by: string | null
  created_at: string
  body: string
  version: number
  modified_at: string
}
interface EntryRow {
  setlist_id: string
  song_uuid: string
  song_id: string
  title: string
  ccli: string | null
  song_key: string | null
  tempo: number | null
  notes: string
  annotations: string
  extra: string
}
interface PersonRow {
  person_id: string
  name: string
  emails: string
  team_member: string | null
  merged_into: string | null
  version: number
  modified_at: string
}
interface PadSetRow {
  pad_set_id: string
  name: string
  version: number
  modified_at: string
}

const songOf = (row: SongRow): SpaceSong => ({
  songUuid: row.song_uuid,
  songId: row.song_id,
  title: row.title,
  ccli: row.ccli,
  key: row.song_key,
  licence: row.licence,
  isDefault: row.is_default === 1,
  variantOf: row.variant_of,
  variantLabel: row.variant_label,
  contentHash: row.content_hash,
  fileRef: row.file_ref,
  version: row.version,
  modifiedAt: row.modified_at,
})

const entryOf = (row: EntryRow): SpaceSetlistSong => ({
  songUuid: row.song_uuid,
  songId: row.song_id,
  title: row.title,
  ccli: row.ccli,
  key: row.song_key,
  tempo: row.tempo,
  notes: row.notes,
  annotations: JSON.parse(row.annotations),
  extra: JSON.parse(row.extra),
})

const setlistOf = (row: SetlistRow, songs: SpaceSetlistSong[]): SpaceSetlist => ({
  setlistId: row.setlist_id,
  date: row.date,
  time: row.time,
  type: row.type,
  name: row.name,
  leaderId: row.leader_id,
  createdBy: row.created_by,
  createdAt: row.created_at,
  body: JSON.parse(row.body),
  songs,
  version: row.version,
  modifiedAt: row.modified_at,
})

const personOf = (row: PersonRow): SpacePerson => ({
  personId: row.person_id,
  name: row.name,
  emails: JSON.parse(row.emails),
  teamMember: row.team_member,
  mergedInto: row.merged_into,
  version: row.version,
  modifiedAt: row.modified_at,
})

const padSetOf = (row: PadSetRow): SpacePadSet => ({
  padSetId: row.pad_set_id,
  name: row.name,
  version: row.version,
  modifiedAt: row.modified_at,
})

/** Where a team's records are kept: null for a space that is not a live team */
export async function storageOf(db: D1Db, spaceId: string): Promise<'drive' | 'd1' | null> {
  const row = await db
    .prepare('SELECT storage FROM teams WHERE space_id = ? AND ended_at IS NULL')
    .bind(spaceId)
    .first<{ storage: 'drive' | 'd1' }>()
  return row?.storage ?? null
}

/** The first day of the setlists answered by default: a year before `now` */
export function defaultFrom(now: Date): string {
  const from = new Date(now.getTime())
  from.setUTCFullYear(from.getUTCFullYear() - 1)
  return from.toISOString().slice(0, 10)
}

/** What a space holds. `from` is the first day of the setlists wanted, or null for every one */
export async function readSpaceData(
  db: D1Db,
  spaceId: string,
  from: string | null
): Promise<SpaceData> {
  const [songs, setlists, entries, people, padSets] = await Promise.all([
    db
      .prepare('SELECT * FROM space_songs WHERE space_id = ? ORDER BY title, song_uuid')
      .bind(spaceId)
      .all<SongRow>(),
    db
      .prepare(
        `SELECT setlist_id, date, time, type, name, leader_id, created_by, created_at, body, version, modified_at
          FROM space_setlists WHERE space_id = ? AND (? IS NULL OR date >= ?) ORDER BY date, setlist_id`
      )
      .bind(spaceId, from, from)
      .all<SetlistRow>(),
    db
      .prepare(
        `SELECT s.* FROM space_setlist_songs s JOIN space_setlists l ON l.setlist_id = s.setlist_id
          WHERE l.space_id = ? AND (? IS NULL OR l.date >= ?) ORDER BY s.setlist_id, s.position`
      )
      .bind(spaceId, from, from)
      .all<EntryRow>(),
    db
      .prepare('SELECT * FROM space_people WHERE space_id = ? ORDER BY name, person_id')
      .bind(spaceId)
      .all<PersonRow>(),
    db
      .prepare('SELECT * FROM space_pad_sets WHERE space_id = ? ORDER BY name, pad_set_id')
      .bind(spaceId)
      .all<PadSetRow>(),
  ])
  const byList = new Map<string, SpaceSetlistSong[]>()
  for (const row of entries.results) {
    byList.set(row.setlist_id, [...(byList.get(row.setlist_id) ?? []), entryOf(row)])
  }
  return {
    songs: songs.results.map(songOf),
    setlists: setlists.results.map(row => setlistOf(row, byList.get(row.setlist_id) ?? [])),
    people: people.results.map(personOf),
    padSets: padSets.results.map(padSetOf),
    from,
  }
}

/**
 * A tag for what `readSpaceData` would answer, from the number of records, the latest change and the sum of
 * versions of each kind (a delete changes the number; a write the latest change and the sum), and the day the setlists begin
 */
export async function etagOf(db: D1Db, spaceId: string, from: string | null): Promise<string> {
  const row = await db
    .prepare(
      `SELECT
        (SELECT count(*) || ':' || coalesce(max(modified_at), '') || ':' || coalesce(sum(version), 0)
           FROM space_songs WHERE space_id = ?) AS songs,
        (SELECT count(*) || ':' || coalesce(max(modified_at), '') || ':' || coalesce(sum(version), 0)
           FROM space_setlists WHERE space_id = ? AND (? IS NULL OR date >= ?)) AS setlists,
        (SELECT count(*) || ':' || coalesce(max(modified_at), '') || ':' || coalesce(sum(version), 0)
           FROM space_people WHERE space_id = ?) AS people,
        (SELECT count(*) || ':' || coalesce(max(modified_at), '') || ':' || coalesce(sum(version), 0)
           FROM space_pad_sets WHERE space_id = ?) AS pad_sets`
    )
    .bind(spaceId, spaceId, from, from, spaceId, spaceId)
    .first<{ songs: string; setlists: string; people: string; pad_sets: string }>()
  const parts = [from ?? 'all', row?.songs, row?.setlists, row?.people, row?.pad_sets]
  return `"${(await sha256Hex(parts.join('|'))).slice(0, 32)}"`
}

/** One record of a kind, as it is now (null if there is none in this space) */
async function currentOf(
  db: D1Db,
  spaceId: string,
  kind: SpaceRecordKind,
  recordId: string
): Promise<unknown> {
  if (kind === 'setlist') {
    const row = await db
      .prepare(
        `SELECT setlist_id, date, time, type, name, leader_id, created_by, created_at, body, version, modified_at
          FROM space_setlists WHERE space_id = ? AND setlist_id = ?`
      )
      .bind(spaceId, recordId)
      .first<SetlistRow>()
    if (!row) return null
    const { results } = await db
      .prepare('SELECT * FROM space_setlist_songs WHERE setlist_id = ? ORDER BY position')
      .bind(recordId)
      .all<EntryRow>()
    return setlistOf(row, results.map(entryOf))
  }
  const table = { song: 'space_songs', person: 'space_people', 'pad-set': 'space_pad_sets' }[kind]
  const column = { song: 'song_uuid', person: 'person_id', 'pad-set': 'pad_set_id' }[kind]
  const row = await db
    .prepare(`SELECT * FROM ${table} WHERE space_id = ? AND ${column} = ?`)
    .bind(spaceId, recordId)
    .first<SongRow & PersonRow & PadSetRow>()
  /* v8 ignore next -- a song, person or pad set is made in a space that has it: only a setlist's id is shared between spaces */
  if (!row) return null
  return kind === 'song' ? songOf(row) : kind === 'person' ? personOf(row) : padSetOf(row)
}

// ---------------------------------------------------------------------------------------------------------
// Who may change what

/**
 * Whether this person leads a setlist, for the rule on deleting one (docs/SPACES.md, "Roles"): the setlist names its
 * leader (a person of the space, followed through a merge), whose addresses include the one asking; one with no
 * leader that can be found is its maker's
 */
async function leadsSetlist(
  db: D1Db,
  spaceId: string,
  row: SetlistRow,
  identity: Identity
): Promise<boolean> {
  const asking = identity.email.toLowerCase()
  const is = (email: unknown) => typeof email === 'string' && email.toLowerCase() === asking
  // (a setlist written before leaders were people names its leader by email: the database holds `body` as an object)
  if (is((JSON.parse(row.body) as Record<string, unknown>).ownerId)) return true
  const madeIt = is(row.created_by)
  let personId: string | null = row.leader_id
  if (!personId) return madeIt
  for (let hops = 0; hops <= MAX_MERGES; hops++) {
    const person: { emails: string; merged_into: string | null } | null = await db
      .prepare('SELECT emails, merged_into FROM space_people WHERE space_id = ? AND person_id = ?')
      .bind(spaceId, personId)
      .first<{ emails: string; merged_into: string | null }>()
    if (!person) return madeIt
    if ((JSON.parse(person.emails) as unknown[]).some(is)) return true
    if (!person.merged_into) return false
    personId = person.merged_into
  }
  return false
}

// ---------------------------------------------------------------------------------------------------------
// Writing

/**
 * What a failed batch means. The tables refuse a version that is not the next one (`stale_version`, raised by the
 * trigger of migrations/0012_space_data.sql): a write made from an out-of-date record. `exists` is a record made twice,
 * or an id another space has; `foreign` a record whose parent is not there (a setlist's songs, written to one that is gone).
 */
function whyFailed(error: unknown): 'version' | 'exists' | 'foreign' | null {
  const message = String(error)
  if (/stale_version/.test(message)) return 'version'
  if (/UNIQUE constraint failed|PRIMARY KEY/i.test(message)) return 'exists'
  if (/FOREIGN KEY constraint failed/i.test(message)) return 'foreign'
  return null
}

function entryStatements(db: D1Db, setlistId: string, songs: SpaceSetlistSong[]): D1Statement[] {
  return songs.map((song, position) =>
    db
      .prepare(
        `INSERT INTO space_setlist_songs
          (setlist_id, position, song_uuid, song_id, title, ccli, song_key, tempo, notes, annotations, extra)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        setlistId,
        position,
        song.songUuid,
        song.songId,
        song.title,
        song.ccli,
        song.key,
        song.tempo,
        song.notes,
        JSON.stringify(song.annotations),
        JSON.stringify(song.extra)
      )
  )
}

/** The statements that write a record: made (`base` null), or changed from version `base` */
function writeStatements(
  db: D1Db,
  spaceId: string,
  kind: SpaceRecordKind,
  record: unknown,
  recordId: string,
  base: number | null,
  at: string
): D1Statement[] {
  if (kind === 'setlist') {
    const s = parseSetlist(record, recordId)
    const columns = [
      s.date,
      s.time,
      s.type,
      s.name,
      s.leaderId,
      s.createdBy,
      s.createdAt,
      JSON.stringify(s.body),
    ]
    if (base === null) {
      return [
        db
          .prepare(
            `INSERT INTO space_setlists
              (space_id, setlist_id, date, time, type, name, leader_id, created_by, created_at, body, version, modified_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
          )
          .bind(spaceId, recordId, ...columns, at),
        ...entryStatements(db, recordId, s.songs),
      ]
    }
    return [
      db
        .prepare(
          `UPDATE space_setlists SET date = ?, time = ?, type = ?, name = ?, leader_id = ?, created_by = ?,
              created_at = ?, body = ?, version = ?, modified_at = ?
            WHERE space_id = ? AND setlist_id = ?`
        )
        .bind(...columns, base + 1, at, spaceId, recordId),
      db.prepare('DELETE FROM space_setlist_songs WHERE setlist_id = ?').bind(recordId),
      ...entryStatements(db, recordId, s.songs),
    ]
  }
  if (kind === 'song') {
    const s = parseSong(record, recordId)
    const values = [
      s.songId,
      s.title,
      s.ccli,
      s.key,
      s.licence,
      s.isDefault ? 1 : 0,
      s.variantOf,
      s.variantLabel,
      s.contentHash,
      s.fileRef,
    ]
    return base === null
      ? [
          db
            .prepare(
              `INSERT INTO space_songs (space_id, song_uuid, song_id, title, ccli, song_key, licence, is_default,
                  variant_of, variant_label, content_hash, file_ref, version, modified_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
            )
            .bind(spaceId, recordId, ...values, at),
        ]
      : [
          db
            .prepare(
              `UPDATE space_songs SET song_id = ?, title = ?, ccli = ?, song_key = ?, licence = ?, is_default = ?,
                  variant_of = ?, variant_label = ?, content_hash = ?, file_ref = ?, version = ?, modified_at = ?
                WHERE space_id = ? AND song_uuid = ?`
            )
            .bind(...values, base + 1, at, spaceId, recordId),
        ]
  }
  if (kind === 'person') {
    const p = parsePerson(record, recordId)
    const values = [p.name, JSON.stringify(p.emails), p.teamMember, p.mergedInto]
    return base === null
      ? [
          db
            .prepare(
              `INSERT INTO space_people (space_id, person_id, name, emails, team_member, merged_into, version, modified_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
            )
            .bind(spaceId, recordId, ...values, at),
        ]
      : [
          db
            .prepare(
              `UPDATE space_people SET name = ?, emails = ?, team_member = ?, merged_into = ?, version = ?,
                  modified_at = ? WHERE space_id = ? AND person_id = ?`
            )
            .bind(...values, base + 1, at, spaceId, recordId),
        ]
  }
  const pad = parsePadSet(record, recordId)
  return base === null
    ? [
        db
          .prepare(
            'INSERT INTO space_pad_sets (space_id, pad_set_id, name, version, modified_at) VALUES (?, ?, ?, 1, ?)'
          )
          .bind(spaceId, recordId, pad.name, at),
      ]
    : [
        db
          .prepare(
            'UPDATE space_pad_sets SET name = ?, version = ?, modified_at = ? WHERE space_id = ? AND pad_set_id = ?'
          )
          .bind(pad.name, base + 1, at, spaceId, recordId),
      ]
}

const TABLE = {
  setlist: 'space_setlists',
  song: 'space_songs',
  person: 'space_people',
  'pad-set': 'space_pad_sets',
} as const
const COLUMN = {
  setlist: 'setlist_id',
  song: 'song_uuid',
  person: 'person_id',
  'pad-set': 'pad_set_id',
} as const

/** Make, change or delete one record, if this person may; what became of it */
export async function applyOp(
  db: D1Db,
  spaceId: string,
  actor: Actor,
  op: SpaceOp,
  now: Date
): Promise<SpaceOpResult> {
  const { kind, id: recordId } = op
  if (!(kind in TABLE) || typeof recordId !== 'string' || !ID.test(recordId)) {
    return { status: 'invalid', error: 'Not a kind of record, or not an id' }
  }
  const base = op.baseVersion
  if (op.op === 'put' && base !== null && !(Number.isInteger(base) && (base as number) >= 1)) {
    return {
      status: 'invalid',
      error: 'baseVersion is the version a change was made from, or null to make a record',
    }
  }
  if (
    op.op === 'delete' &&
    base !== undefined &&
    base !== null &&
    !(Number.isInteger(base) && base >= 1)
  ) {
    return { status: 'invalid', error: 'baseVersion is a version' }
  }
  const { role } = actor
  // (who may: a member of any role adds a pad set; every other change is a writer's, and a pad set's change is an admin's)
  if (kind === 'pad-set') {
    const adding = op.op === 'put' && base === null
    if (!atLeast(role, adding ? 'reader' : 'admin')) {
      return { status: 'forbidden', error: 'Only an admin can change or delete a pad set' }
    }
  } else if (!atLeast(role, 'writer')) {
    return { status: 'forbidden', error: 'This role may not change the space’s records' }
  }

  if (op.op === 'delete') {
    if (kind === 'setlist' && !atLeast(role, 'admin')) {
      const row = await db
        .prepare('SELECT * FROM space_setlists WHERE space_id = ? AND setlist_id = ?')
        .bind(spaceId, recordId)
        .first<SetlistRow>()
      if (row && !(await leadsSetlist(db, spaceId, row, actor.identity))) {
        return {
          status: 'forbidden',
          error: 'Only the leader of a setlist or an admin can delete it',
        }
      }
    }
    const statements: D1Statement[] = []
    if (typeof base === 'number') {
      // (naming the next version is the check: the table refuses it, and with it the delete, if the record has moved on)
      statements.push(
        db
          .prepare(
            `UPDATE ${TABLE[kind]} SET version = ? WHERE space_id = ? AND ${COLUMN[kind]} = ?`
          )
          .bind(base + 1, spaceId, recordId)
      )
    }
    statements.push(
      db
        .prepare(`DELETE FROM ${TABLE[kind]} WHERE space_id = ? AND ${COLUMN[kind]} = ?`)
        .bind(spaceId, recordId)
    )
    try {
      await db.batch(statements)
    } catch (error) {
      if (whyFailed(error) !== 'version') throw error
      return { status: 'conflict', current: await currentOf(db, spaceId, kind, recordId) }
    }
    return { status: 'ok', version: 0 }
  }

  if (op.op !== 'put' || base === undefined) {
    return { status: 'invalid', error: 'A change is a put with a baseVersion, or a delete' }
  }
  const at = now.toISOString()
  let statements: D1Statement[]
  try {
    statements = writeStatements(db, spaceId, kind, op.record, recordId, base, at)
  } catch (error) {
    /* v8 ignore next 3 -- an Invalid is bad input, tested through the routes; anything else is a bug, left to be the 502 */
    if (error instanceof Invalid) return { status: 'invalid', error: error.message }
    throw error
  }
  try {
    const results = await db.batch(statements)
    // (a change of a record that is not there changes no row: it was deleted since the writer saw it)
    if (base !== null && results[0].meta.changes === 0) return { status: 'missing' }
  } catch (error) {
    const why = whyFailed(error)
    if (!why) throw error
    const current = await currentOf(db, spaceId, kind, recordId)
    if (current === null && why !== 'exists') return { status: 'missing' }
    // (a record of another space with this id is not shown: `current` is null, and the id is taken)
    return { status: 'conflict', current }
  }
  return { status: 'ok', version: base === null ? 1 : base + 1 }
}

// ---------------------------------------------------------------------------------------------------------
// Naming oneself

/** The most a name is */
const MAX_NAME = 100

/**
 * Change the name of a person of the space, for the member that person is: any role may name themselves, as in the
 * Drive-backed API (docs/IDENTITIES.md, "Who may edit people"). The person must have the verified address of whoever is
 * asking, and nothing but the name changes.
 */
async function renamePerson(
  db: D1Db,
  spaceId: string,
  personId: string,
  body: Record<string, unknown>,
  identity: Identity,
  now: Date
): Promise<Response> {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > MAX_NAME || /\p{Cc}/u.test(name)) {
    throw new Refusal(400, 'A name is one line of text, up to 100 characters')
  }
  const row = await db
    .prepare('SELECT * FROM space_people WHERE space_id = ? AND person_id = ?')
    .bind(spaceId, personId)
    .first<PersonRow>()
  if (!row || row.merged_into) return jsonResponse({ error: 'No such person' }, 404)
  const emails = JSON.parse(row.emails) as unknown[]
  if (
    !emails.some(
      each => typeof each === 'string' && each.toLowerCase() === identity.email.toLowerCase()
    )
  ) {
    throw new Refusal(403, 'That person is not you')
  }
  await db
    .prepare(
      'UPDATE space_people SET name = ?, version = version + 1, modified_at = ? WHERE space_id = ? AND person_id = ?'
    )
    .bind(name, now.toISOString(), spaceId, personId)
    .run()
  return jsonResponse({ person: await currentOf(db, spaceId, 'person', personId) })
}

// ---------------------------------------------------------------------------------------------------------
// The routes

const KIND_OF_SEGMENT: Record<string, SpaceRecordKind> = {
  setlists: 'setlist',
  songs: 'song',
  people: 'person',
  'pad-sets': 'pad-set',
}

const RECORD = /^\/(setlists|songs|people|pad-sets)\/([^/]+)$/
const NAME = /^\/people\/([^/]+)\/name$/

/** Whether a path under a space is one of these routes */
export function isSpaceDataRoute(rest: string): boolean {
  return rest === '/data' || rest === '/batch' || RECORD.test(rest) || NAME.test(rest)
}

/** The HTTP answer for what became of a change */
function answerOf(result: SpaceOpResult): Response {
  switch (result.status) {
    case 'ok':
      return jsonResponse({ version: result.version })
    case 'conflict':
      return jsonResponse({ error: 'conflict', current: result.current }, 409)
    case 'missing':
      return jsonResponse({ error: 'missing' }, 404)
    case 'forbidden':
      return jsonResponse({ error: result.error }, 403)
    case 'invalid':
      return jsonResponse({ error: result.error }, 400)
  }
}

function asOp(value: unknown): SpaceOp {
  if (!isRecord(value)) throw new Refusal(400, 'A change must be an object')
  return value as unknown as SpaceOp
}

/** The data of a space, with its tag: 304 when the one the device sent is still right */
export async function dataResponse(
  db: D1Db,
  spaceId: string,
  request: Request,
  now: Date
): Promise<Response> {
  const from = new URL(request.url).searchParams.get('all') === '1' ? null : defaultFrom(now)
  const etag = await etagOf(db, spaceId, from)
  if (request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } })
  }
  const body = JSON.stringify(await readSpaceData(db, spaceId, from))
  return new Response(body, { headers: { 'Content-Type': 'application/json', ETag: etag } })
}

/**
 * Answer a space data request, or null for one that is not for this to answer (a team still on Drive: the files API
 * is). `rest` was matched by `isSpaceDataRoute`; who is asking, and their role, were settled first.
 */
export async function handleSpaceData(
  request: Request,
  spaceId: string,
  rest: string,
  db: D1Db,
  actor: Actor,
  now: Date = new Date()
): Promise<Response | null> {
  let passed = false
  const answer = await answering('Space data', async () => {
    const made = await answerSpaceData(request, spaceId, rest, db, actor, now)
    passed = made === null
    return made ?? new Response(null)
  })
  return passed ? null : answer
}

async function answerSpaceData(
  request: Request,
  spaceId: string,
  rest: string,
  db: D1Db,
  actor: Actor,
  now: Date
): Promise<Response | null> {
  const storage = await storageOf(db, spaceId)
  if (storage !== 'd1') {
    // (naming oneself on a team still on Drive is the files API's)
    return NAME.test(rest) ? null : jsonResponse({ error: 'not_moved' }, 409)
  }
  const method = request.method

  if (method === 'GET' && rest === '/data') return dataResponse(db, spaceId, request, now)

  const name = NAME.exec(rest)
  if (method === 'PUT' && name) {
    return renamePerson(
      db,
      spaceId,
      decodeURIComponent(name[1]),
      await readJson(request),
      actor.identity,
      now
    )
  }

  if (method === 'POST' && rest === '/batch') {
    const ops = (await readJson(request)).ops
    if (!Array.isArray(ops) || ops.length > MAX_OPS)
      throw new Refusal(400, `ops must be a list of at most ${MAX_OPS}`)
    const results: SpaceOpResult[] = []
    // (one at a time, each its own answer: a change that is refused does not stop the others)
    for (const each of ops) results.push(await applyOp(db, spaceId, actor, asOp(each), now))
    return jsonResponse({ results })
  }

  const record = RECORD.exec(rest)
  if (record && (method === 'PUT' || method === 'DELETE')) {
    const kind = KIND_OF_SEGMENT[record[1]]
    const recordId = decodeURIComponent(record[2])
    if (method === 'PUT') {
      const body = await readJson(request)
      return answerOf(
        await applyOp(
          db,
          spaceId,
          actor,
          {
            kind,
            op: 'put',
            id: recordId,
            baseVersion: body.baseVersion as number | null | undefined,
            record: body.record,
          },
          now
        )
      )
    }
    const given = new URL(request.url).searchParams.get('baseVersion')
    return answerOf(
      await applyOp(
        db,
        spaceId,
        actor,
        {
          kind,
          op: 'delete',
          id: recordId,
          baseVersion: given === null ? undefined : Number(given),
        },
        now
      )
    )
  }
  return jsonResponse({ error: 'Not found' }, 404)
}

/**
 * `POST /api/spaces/data { all?, etags? }`: the data of every space this account is in that has moved, in one answer. A
 * space whose tag is still right is answered `{unchanged: true}`; one that has not moved `{moved: false}` (the device
 * uses Drive for it)
 */
export function handleAllSpaceData(
  request: Request,
  db: D1Db,
  spaces: { spaceId: string }[],
  now: Date = new Date()
): Promise<Response> {
  return answering('Space data', async () => {
    const body = await readJson(request)
    const etags = isRecord(body.etags) ? body.etags : {}
    const from = body.all === true ? null : defaultFrom(now)
    const answers: Record<string, unknown> = {}
    for (const { spaceId } of spaces) {
      if ((await storageOf(db, spaceId)) !== 'd1') {
        answers[spaceId] = { moved: false }
        continue
      }
      const etag = await etagOf(db, spaceId, from)
      answers[spaceId] =
        etags[spaceId] === etag
          ? { unchanged: true, etag }
          : { etag, data: await readSpaceData(db, spaceId, from) }
    }
    return jsonResponse({ spaces: answers })
  })
}
