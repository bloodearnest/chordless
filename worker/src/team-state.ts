/**
 * What a team space is (docs/SPACES.md, "Setting up and joining a team space"), kept in D1
 * (migrations/0002_team_state.sql): who owns the space, who its members are and their roles, which Drive
 * files are in its tree, and the owner's encrypted token blob, or that the space uses Chordless's
 * service account instead. It holds **no song, setlist or pad content**: only these records
 * (CLAUDE.md, "Spaces and copyright"). The space is a row of `teams`, which stays, marked ended, when
 * sharing stops, with its `team_events`: the register CCLI may ask for and charging may use. Everything
 * else of the space is deleted when sharing ends.
 *
 * Members are keyed by `identityKey` (provider and sub), not by email: an email is for showing and
 * for matching an invite, but it is the account that is a member. The live sockets are the Durable
 * Object's (team-room.ts), told when someone's membership changes.
 */
import { toBase64Url } from '../../src/js/base64url.ts'
import type { LicenceChange } from '../../src/js/ccli-licence.ts'
import type { InviteInfo, MemberRole, TeamMember, TeamRole } from '../../src/js/team-roles.ts'
import { sha256Hex } from '../../src/js/utils/bytes.ts'
import type { D1Db, D1Statement } from './d1.ts'
import { type Identity, identityKey } from './identity.ts'

export interface SpaceInfo {
  /** Drive's id of the space's folder (or a shared drive's folder) */
  rootRef: string
  name: string
  owner: Identity
  createdAt: string
}

/**
 * How the Worker reaches the space's Drive (docs/SPACES.md, "Credentials"): with the owner's own
 * sign-in (the blob), or with Chordless's service account, a member of the team's shared drive
 */
export type SpaceCredential = 'owner' | 'service-account'

/** What the Worker asks of a space: the rules (`TeamSpaceState`) behind the routes */
export interface TeamSpaceApi {
  /** Make the space; false (and nothing changed) if it already exists */
  create(space: { rootRef: string; name: string; owner: Identity }): Promise<boolean>
  info(): Promise<SpaceInfo | null>
  /** This account's role in the space, or null if it is not a member */
  roleOf(identity: Pick<Identity, 'provider' | 'sub'>): Promise<TeamRole | null>
  /** The owner first, then the members by email */
  members(): Promise<TeamMember[]>
  /** Add a member, or change their role */
  setMember(identity: Identity, role: MemberRole): Promise<void>
  removeMember(identity: Identity): Promise<void>
  /**
   * Make an invite for the person with this email to join with this role; the code is returned
   * once, never kept
   */
  createInvite(
    role: MemberRole,
    email: string,
    by: Identity
  ): Promise<{ code: string; expiresAt: string }>
  invites(): Promise<InviteInfo[]>
  /** True if there was such an invite */
  revokeInvite(id: string): Promise<boolean>
  /**
   * Join with an invite's code: the role given, null if the code is not good (unknown, used,
   * expired), or 'other-account' if it is for another email than this account's. It is used up
   * once; someone already in the space keeps their role and uses nothing.
   */
  redeemInvite(code: string, identity: Identity): Promise<TeamRole | 'other-account' | null>
  /** Change a member's role by email; false if there is no such member */
  setRoleByEmail(email: string, role: MemberRole): Promise<boolean>
  /** Remove a member by email; false if there is no such member */
  removeByEmail(email: string): Promise<boolean>
  /**
   * End sharing: the members, invites, files and the owner's blob are forgotten and the live sockets
   * closed. The space stays in the register, marked, with its licence number and history.
   */
  destroy(by: Identity): Promise<void>
  /** Note that these files are in the space's tree (they stay noted when binned); repeats are free */
  addRefs(refs: string[]): Promise<void>
  owns(ref: string): Promise<boolean>
  /** Those of these refs that are in the space's tree (a feed of changes covers more than the space) */
  ownedAmong(refs: string[]): Promise<string[]>
  /** The owner's token blob, as encrypted by the Worker's key; null if there is none */
  ownerBlob(): Promise<string | null>
  /** Keep the owner's sign-in, and use it: the space is the owner's to reach again */
  setOwnerBlob(blob: string): Promise<void>
  clearOwnerBlob(): Promise<void>
  /** Which credential the space uses ('owner' until it is switched) */
  credential(): Promise<SpaceCredential>
  /**
   * Use the service account, and forget the owner's sign-in: the switch first, so a failure between
   * the two leaves the old sign-in kept but no longer used, never the space with neither
   */
  useServiceAccount(): Promise<void>
  /** The team's CCLI licence number (null if none was given) and the log of its changes, oldest first */
  licence(): Promise<{ ccliLicence: string | null; history: LicenceChange[] }>
  /**
   * Set the licence number (null to clear it), logging who did it and when. False, and no log
   * entry, where it is already that. The log is only ever added to (until the space is forgotten).
   */
  setLicence(ccliLicence: string | null, by: Identity): Promise<boolean>
  /**
   * A device going live (a WebSocket upgrade, which the Worker has authorised; live-relay.ts): the
   * space's live room (team-room.ts) has it. Absent where there is no room
   */
  fetch?(request: Request): Response | Promise<Response>
}

/** The live room of a space, which holds its sockets (team-room.ts): the part the state uses */
export interface LiveSockets {
  /** A device going live: the room's answer, a 101 with the socket */
  fetch(request: Request): Response | Promise<Response>
  /** Close the live sockets of this account (`provider:sub`), or all of them: the next connect is asked again */
  dropSockets(identity?: string): Promise<void>
}

/** The hash an invite is kept under: the code is a secret, so it is not stored */
const hashOf = sha256Hex

/** A new code: 128 random bits, as URL-safe text */
function newCode(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
}

/** How long an invite can be used */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** The most refs sent in one statement (as one JSON value: D1 limits the values a statement binds) */
const REF_CHUNK = 500

const EVENT =
  'INSERT INTO team_events (space_id, at, kind, by_email, detail) VALUES (?, ?, ?, ?, ?)'

interface SpaceRow {
  root_ref: string
  name: string
  owner_provider: string
  owner_sub: string
  owner_email: string
  created_at: string
}

interface InviteRow {
  id: string
  email: string
  role: MemberRole
  created_by: string
  created_at: string
  expires_at: string
}

/** The list in pieces of this size */
function chunks<T>(items: T[], size: number): T[][] {
  const pieces: T[][] = []
  for (let start = 0; start < items.length; start += size)
    pieces.push(items.slice(start, start + size))
  return pieces
}

export class TeamSpaceState implements TeamSpaceApi {
  #db: D1Db
  #id: string
  #now: () => Date
  #sockets: LiveSockets | undefined
  /** Set where there is a live room (see `TeamSpaceApi.fetch`) */
  fetch?: (request: Request) => Response | Promise<Response>

  constructor(
    db: D1Db,
    spaceId: string,
    options: { now?: () => Date; sockets?: LiveSockets } = {}
  ) {
    this.#db = db
    this.#id = spaceId
    this.#now = options.now ?? (() => new Date())
    this.#sockets = options.sockets
    const sockets = this.#sockets
    if (sockets) this.fetch = request => sockets.fetch(request)
  }

  /** A statement about this space: its id is the first value bound, then these */
  #sql(sql: string, ...values: unknown[]): D1Statement {
    return this.#db.prepare(sql).bind(this.#id, ...values)
  }

  #at(): string {
    return this.#now().toISOString()
  }

  #event(kind: string, by: string, detail?: object): D1Statement {
    return this.#db
      .prepare(EVENT)
      .bind(this.#id, this.#at(), kind, by.toLowerCase(), detail ? JSON.stringify(detail) : null)
  }

  /** Close the live sockets of an account (all if none is named): what they may do has changed */
  async #drop(key?: string): Promise<void> {
    await this.#sockets?.dropSockets(key)
  }

  async create(space: { rootRef: string; name: string; owner: Identity }): Promise<boolean> {
    const at = this.#at()
    const { owner } = space
    const made = await this.#db
      .prepare(
        `INSERT OR IGNORE INTO teams
          (space_id, name, owner_email, created_at, updated_at, root_ref, owner_provider, owner_sub)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        this.#id,
        space.name,
        owner.email.toLowerCase(),
        at,
        at,
        space.rootRef,
        owner.provider,
        owner.sub
      )
      .run()
    if (made.meta.changes === 0) return false
    await this.#event('created', owner.email).run()
    return true
  }

  async info(): Promise<SpaceInfo | null> {
    const row = await this.#sql(
      `SELECT root_ref, name, owner_provider, owner_sub, owner_email, created_at
        FROM teams WHERE space_id = ? AND ended_at IS NULL`
    ).first<SpaceRow>()
    return row
      ? {
          rootRef: row.root_ref,
          name: row.name,
          owner: { provider: row.owner_provider, sub: row.owner_sub, email: row.owner_email },
          createdAt: row.created_at,
        }
      : null
  }

  async roleOf(identity: Pick<Identity, 'provider' | 'sub'>): Promise<TeamRole | null> {
    const key = identityKey(identity)
    // (one round trip: every request asks)
    const row = await this.#db
      .prepare(
        `SELECT CASE WHEN t.owner_provider || ':' || t.owner_sub = ? THEN 'owner' ELSE m.role END AS role
          FROM teams t LEFT JOIN team_members m ON m.space_id = t.space_id AND m.identity = ?
          WHERE t.space_id = ? AND t.ended_at IS NULL`
      )
      .bind(key, key, this.#id)
      .first<{ role: TeamRole | null }>()
    return row?.role ?? null
  }

  async members(): Promise<TeamMember[]> {
    const info = await this.info()
    if (!info) return []
    const { results } = await this.#sql(
      'SELECT email, role FROM team_members WHERE space_id = ? ORDER BY email'
    ).all<TeamMember>()
    return [{ email: info.owner.email, role: 'owner' }, ...results]
  }

  async setMember(identity: Identity, role: MemberRole): Promise<void> {
    const info = await this.info()
    if (!info) throw new Error('No such space')
    if (identityKey(info.owner) === identityKey(identity)) {
      throw new Error('The owner is not a member: their role cannot be changed')
    }
    const key = identityKey(identity)
    await this.#sql(
      `INSERT INTO team_members (space_id, identity, email, role, since) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (space_id, identity) DO UPDATE SET email = excluded.email, role = excluded.role`,
      key,
      identity.email.toLowerCase(),
      role,
      this.#at()
    ).run()
    await this.#drop(key)
  }

  async removeMember(identity: Identity): Promise<void> {
    const key = identityKey(identity)
    await this.#sql('DELETE FROM team_members WHERE space_id = ? AND identity = ?', key).run()
    await this.#drop(key)
  }

  /** The key of the member with this email */
  async #byEmail(email: string): Promise<string | null> {
    const row = await this.#sql(
      'SELECT identity FROM team_members WHERE space_id = ? AND email = ?',
      email.toLowerCase()
    ).first<{ identity: string }>()
    return row?.identity ?? null
  }

  async setRoleByEmail(email: string, role: MemberRole): Promise<boolean> {
    const key = await this.#byEmail(email)
    if (!key) return false
    await this.#db
      .prepare('UPDATE team_members SET role = ? WHERE space_id = ? AND identity = ?')
      .bind(role, this.#id, key)
      .run()
    await this.#drop(key)
    return true
  }

  async removeByEmail(email: string): Promise<boolean> {
    const key = await this.#byEmail(email)
    if (!key) return false
    await this.#sql('DELETE FROM team_members WHERE space_id = ? AND identity = ?', key).run()
    await this.#drop(key)
    return true
  }

  async createInvite(role: MemberRole, email: string, by: Identity) {
    const code = newCode()
    const created = this.#now()
    const expiresAt = new Date(created.getTime() + INVITE_TTL_MS).toISOString()
    await this.#sql(
      `INSERT INTO team_invites (space_id, id, email, role, created_by, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      await hashOf(code),
      email.trim().toLowerCase(),
      role,
      by.email.toLowerCase(),
      created.toISOString(),
      expiresAt
    ).run()
    return { code, expiresAt }
  }

  async invites(): Promise<InviteInfo[]> {
    const { results } = await this.#sql(
      `SELECT id, email, role, created_by, created_at, expires_at FROM team_invites
        WHERE space_id = ? AND expires_at > ? ORDER BY created_at`,
      this.#at()
    ).all<InviteRow>()
    return results.map(row => ({
      id: row.id,
      email: row.email,
      role: row.role,
      createdBy: row.created_by,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }))
  }

  async revokeInvite(id: string): Promise<boolean> {
    const gone = await this.#sql('DELETE FROM team_invites WHERE space_id = ? AND id = ?', id).run()
    return gone.meta.changes > 0
  }

  async redeemInvite(code: string, identity: Identity): Promise<TeamRole | 'other-account' | null> {
    const id = await hashOf(code)
    const invite = await this.#sql(
      'SELECT email, role, expires_at FROM team_invites WHERE space_id = ? AND id = ?',
      id
    ).first<{ email: string; role: MemberRole; expires_at: string }>()
    if (!invite || invite.expires_at <= this.#at()) return null
    const current = await this.roleOf(identity)
    if (current) return current
    // (Google verified the account's email at sign-in: the invite is for whoever has that address)
    if (identity.email.toLowerCase() !== invite.email) return 'other-account'
    await this.setMember(identity, invite.role)
    await this.#sql('DELETE FROM team_invites WHERE space_id = ? AND id = ?', id).run()
    return invite.role
  }

  async destroy(by: Identity): Promise<void> {
    if (!(await this.info())) return
    const at = this.#at()
    await this.#db.batch([
      this.#db
        .prepare('UPDATE teams SET ended_at = ?, updated_at = ? WHERE space_id = ?')
        .bind(at, at, this.#id),
      this.#event('ended', by.email),
      this.#sql('DELETE FROM team_members WHERE space_id = ?'),
      this.#sql('DELETE FROM team_invites WHERE space_id = ?'),
      this.#sql('DELETE FROM team_refs WHERE space_id = ?'),
      this.#sql('DELETE FROM team_credentials WHERE space_id = ?'),
    ])
    await this.#drop()
  }

  async addRefs(refs: string[]): Promise<void> {
    // (a listing repeats the same refs every sync: the ones already noted are ignored)
    for (const some of chunks([...new Set(refs)], REF_CHUNK)) {
      await this.#db
        .prepare(
          'INSERT OR IGNORE INTO team_refs (space_id, ref) SELECT ?, value FROM json_each(?)'
        )
        .bind(this.#id, JSON.stringify(some))
        .run()
    }
  }

  async owns(ref: string): Promise<boolean> {
    return Boolean(
      await this.#sql(
        'SELECT 1 AS found FROM team_refs WHERE space_id = ? AND ref = ?',
        ref
      ).first()
    )
  }

  async ownedAmong(refs: string[]): Promise<string[]> {
    const owned: string[] = []
    for (const some of chunks(refs, REF_CHUNK)) {
      const { results } = await this.#sql(
        `SELECT ref FROM team_refs WHERE space_id = ? AND ref IN (SELECT value FROM json_each(?))`,
        JSON.stringify(some)
      ).all<{ ref: string }>()
      const found = new Set(results.map(row => row.ref))
      owned.push(...some.filter(ref => found.has(ref)))
    }
    return owned
  }

  async ownerBlob(): Promise<string | null> {
    const row = await this.#sql('SELECT blob FROM team_credentials WHERE space_id = ?').first<{
      blob: string
    }>()
    return row?.blob ?? null
  }

  async setOwnerBlob(blob: string): Promise<void> {
    await this.#db.batch([
      this.#sql(
        `INSERT INTO team_credentials (space_id, blob) VALUES (?, ?)
          ON CONFLICT (space_id) DO UPDATE SET blob = excluded.blob`,
        blob
      ),
      this.#sql("UPDATE teams SET credential = 'owner' WHERE space_id = ?"),
    ])
  }

  async credential(): Promise<SpaceCredential> {
    const row = await this.#sql('SELECT credential FROM teams WHERE space_id = ?').first<{
      credential: SpaceCredential
    }>()
    return row?.credential ?? 'owner'
  }

  async useServiceAccount(): Promise<void> {
    // (together: never the space with neither, nor with a sign-in kept that is no longer used)
    await this.#db.batch([
      this.#sql("UPDATE teams SET credential = 'service-account' WHERE space_id = ?"),
      this.#sql('DELETE FROM team_credentials WHERE space_id = ?'),
    ])
  }

  async clearOwnerBlob(): Promise<void> {
    await this.#sql('DELETE FROM team_credentials WHERE space_id = ?').run()
  }

  async licence(): Promise<{ ccliLicence: string | null; history: LicenceChange[] }> {
    const row = await this.#sql(
      'SELECT ccli_licence FROM teams WHERE space_id = ? AND ended_at IS NULL'
    ).first<{ ccli_licence: string | null }>()
    if (!row) return { ccliLicence: null, history: [] }
    const { results } = await this.#sql(
      "SELECT at, by_email, detail FROM team_events WHERE space_id = ? AND kind = 'licence' ORDER BY id"
    ).all<{ at: string; by_email: string; detail: string }>()
    return {
      ccliLicence: row.ccli_licence,
      history: results.map(({ at, by_email, detail }) => ({
        at,
        by: by_email,
        ...(JSON.parse(detail) as { from: string | null; to: string | null }),
      })),
    }
  }

  async setLicence(ccliLicence: string | null, by: Identity): Promise<boolean> {
    if (!(await this.info())) throw new Error('No such space')
    const { ccliLicence: from } = await this.licence()
    if (from === ccliLicence) return false
    await this.#db.batch([
      this.#db
        .prepare('UPDATE teams SET ccli_licence = ?, updated_at = ? WHERE space_id = ?')
        .bind(ccliLicence, this.#at(), this.#id),
      this.#event('licence', by.email, { from, to: ccliLicence }),
    ])
    return true
  }
}
