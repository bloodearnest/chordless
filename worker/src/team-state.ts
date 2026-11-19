/**
 * What a team space is (docs/SPACES.md, "Setting up and joining a team space"), kept in D1
 * (migrations/0002_team_state.sql): who owns the space, who its members are and their roles, which Drive
 * files are in its tree, and the owner's encrypted token blob, or that the space uses Chordless's
 * service account instead. It holds **no song, setlist or pad content**: only these records
 * (CLAUDE.md, "Spaces and copyright"). The space is a row of `teams`, which stays, marked ended, when
 * sharing stops, with its `team_events`: the register CCLI may ask for and charging may use. Everything
 * else of the space is deleted when sharing ends.
 *
 * A member is an **account** (migrations/0003_accounts.sql): a person's Chordless account, which holds
 * the logins they sign in with (a provider and its id for them: `identityKey`) and the addresses they
 * are known by. A login is looked up to its account, and the account has the role; an email is for
 * showing and for matching an invite. `team_members.identity` (the first login) and `.email` stay,
 * kept right, for the Worker a rollback would bring back. The live sockets are the Durable Object's
 * (team-room.ts), told when someone's membership changes.
 */
import { toBase64Url } from '../../src/js/base64url.ts'
import type { LicenceChange } from '../../src/js/ccli-licence.ts'
import type { InviteInfo, MemberRole, TeamMember, TeamRole } from '../../src/js/team-roles.ts'
import { sha256Hex } from '../../src/js/utils/bytes.ts'
import type { D1Db, D1Statement } from './d1.ts'
import { type Identity, identityKey, SESSION_PROVIDER } from './identity.ts'

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
  /**
   * Make the space; false (and nothing changed) if it already exists. `owner` is the login whose Drive sign-in
   * the space uses; `ownerAccount` is the account that owns it, where the caller already knows it (a session's)
   */
  create(space: {
    rootRef: string
    name: string
    owner: Identity
    ownerAccount?: string
  }): Promise<boolean>
  info(): Promise<SpaceInfo | null>
  /** This account's role in the space, or null if it is not a member */
  roleOf(identity: Pick<Identity, 'provider' | 'sub'>): Promise<TeamRole | null>
  /** The owner first, then the members by email, each with every address the team knows them by */
  members(): Promise<TeamMember[]>
  /**
   * Add a member, or change their role. `invitedAs` is the address an invite was sent to, when they
   * joined with another: kept as one of the member's addresses (a label, never proof), unless
   * another member already has it
   */
  setMember(identity: Identity, role: MemberRole, options?: { invitedAs?: string }): Promise<void>
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
  /** Note that the invite with this code was emailed, now */
  markInviteEmailed(code: string): Promise<void>
  invites(): Promise<InviteInfo[]>
  /** True if there was such an invite */
  revokeInvite(id: string): Promise<boolean>
  /**
   * What an invite's code is for, without using it up: the team's name, the role and the address it was
   * sent to; null if the code is not good (unknown, used, expired, or the team has ended)
   */
  inviteInfo(code: string): Promise<{ teamName: string; role: MemberRole; email: string } | null>
  /**
   * Join with an invite's code: the role given, null if the code is not good (unknown, used,
   * expired), or 'other-account' for an **admin** invite and an account whose email is not the one
   * it was sent to. Any other invite is for whoever has it: the address it was sent to is kept as one
   * of their addresses when it is not theirs, and the join is noted in the team's history. It is used
   * up once; someone already in the space keeps their role and uses nothing.
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
  emailed_at: string | null
}

/** The list in pieces of this size */
function chunks<T>(items: T[], size: number): T[][] {
  const pieces: T[][] = []
  for (let start = 0; start < items.length; start += size)
    pieces.push(items.slice(start, start + size))
  return pieces
}

/** The key for a new account: 128 random bits as hex, as the migration's backfill makes them */
function newAccountId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** The account that owns an address (docs/ACCOUNT.md: one account to an address), if any does */
export async function ownerOfAddress(db: D1Db, email: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT account_id FROM account_emails WHERE email = ?')
    .bind(email.toLowerCase())
    .first<{ account_id: string }>()
  return row?.account_id ?? null
}

/**
 * Make an address the account's, unless another account has it already. Returns the account that has it:
 * the argument if the claim held (or it was theirs already), another if it was taken. The address must have
 * been vouched for (verified by its provider, or proved by a code).
 */
export async function claimAddress(
  db: D1Db,
  accountId: string,
  email: string,
  now: Date
): Promise<string> {
  const address = email.toLowerCase()
  if (!address) return accountId
  await db
    .prepare(
      'INSERT OR IGNORE INTO account_emails (email, account_id, created_at) VALUES (?, ?, ?)'
    )
    .bind(address, accountId, now.toISOString())
    .run()
  return (await ownerOfAddress(db, address)) ?? accountId
}

/**
 * The account a login belongs to. With `create`, one is made (with the login) the first time a team
 * operation sees it (making a space, joining one), never by a bare request; the login's email and
 * `last_seen_at` are refreshed. Without it, null for a login nothing has made an account for. An
 * identity from a Chordless session already is the account (its `sub`): nothing to look up.
 *
 * With `claim` (the default: an `Identity`'s address is verified), the login's address is made the account's, and a
 * new login whose address another account owns joins that account instead of making one (the same mailbox is the
 * same person; an address belongs to one account).
 */
export async function accountOf(
  db: D1Db,
  identity: Identity,
  create: boolean,
  now: Date = new Date(),
  claim = true
): Promise<string | null> {
  if (identity.provider === SESSION_PROVIDER) return identity.sub
  const find = () =>
    db
      .prepare('SELECT account_id FROM account_identities WHERE provider = ? AND sub = ?')
      .bind(identity.provider, identity.sub)
      .first<{ account_id: string }>()
  const found = await find()
  const at = now.toISOString()
  const email = identity.email.toLowerCase()
  if (found) {
    if (create) {
      await db
        .prepare(
          'UPDATE account_identities SET email = ?, last_seen_at = ? WHERE provider = ? AND sub = ?'
        )
        .bind(email, at, identity.provider, identity.sub)
        .run()
      // (a changed address is added to the account unless another has it: nothing is merged here)
      if (claim) await claimAddress(db, found.account_id, email, now)
    }
    return found.account_id
  }
  if (!create) return null
  const insertLogin = (accountId: string) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO account_identities (provider, sub, account_id, email, created_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(identity.provider, identity.sub, accountId, email, at, at)
  const owner = claim ? await ownerOfAddress(db, email) : null
  if (owner) {
    await insertLogin(owner).run()
    return ((await find()) as { account_id: string }).account_id
  }
  const made = newAccountId()
  await db.batch([
    db.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').bind(made, at),
    insertLogin(made),
  ])
  const winner = ((await find()) as { account_id: string }).account_id
  // (two requests made the login's account at once: the one that lost leaves no orphan)
  if (winner !== made) {
    await db.prepare('DELETE FROM accounts WHERE account_id = ?').bind(made).run()
    return winner
  }
  if (!claim) return made
  // (the address is claimed after the account is made: if a login of another account got it first, in that
  // moment, this brand new account has nothing else yet, so its login moves to the account that has it)
  const holder = await claimAddress(db, made, email, now)
  if (holder === made) return made
  await db
    .prepare('UPDATE account_identities SET account_id = ? WHERE provider = ? AND sub = ?')
    .bind(holder, identity.provider, identity.sub)
    .run()
  await db.prepare('DELETE FROM accounts WHERE account_id = ?').bind(made).run()
  return holder
}

/** A team space the signed-in person is in, as they are told of it on a device that does not have it yet */
export interface MySpace {
  spaceId: string
  name: string
  role: TeamRole
  /** Drive's id of the space's folder: only for the owner, whose device reaches it straight (a member's goes through the Worker) */
  rootRef?: string
}

/**
 * The spaces a person is in, owner or member, that are still shared: what a device that has not
 * joined them yet (a second device, or a new browser) asks, so it can set them up
 */
export async function spacesOf(
  db: D1Db,
  identity: Pick<Identity, 'provider' | 'sub'>
): Promise<MySpace[]> {
  const key = identityKey(identity)
  // (the account is the identity's own for a session; for a login it is looked up, if it has one. Either
  // way it is owner or member; a row the previous Worker made, with no account yet, is found by the key)
  const direct = identity.provider === SESSION_PROVIDER ? identity.sub : null
  const { results } = await db
    .prepare(
      `SELECT t.space_id, t.name, t.root_ref,
          CASE WHEN t.owner_provider || ':' || t.owner_sub = ?
                 OR (acct.id IS NOT NULL AND t.owner_account_id = acct.id)
               THEN 'owner' ELSE m.role END AS role
        FROM teams t
        LEFT JOIN (SELECT COALESCE(?, (SELECT account_id FROM account_identities WHERE provider = ? AND sub = ?)) AS id) acct ON 1
        LEFT JOIN team_members m ON m.space_id = t.space_id
          AND (m.identity = ? OR (acct.id IS NOT NULL AND m.account_id = acct.id))
        WHERE t.ended_at IS NULL
          AND (t.owner_provider || ':' || t.owner_sub = ?
               OR (acct.id IS NOT NULL AND t.owner_account_id = acct.id)
               OR m.identity IS NOT NULL)
        ORDER BY t.created_at, t.space_id`
    )
    .bind(key, direct, identity.provider, identity.sub, key, key)
    .all<{ space_id: string; name: string; root_ref: string; role: TeamRole }>()
  return results.map(row => ({
    spaceId: row.space_id,
    name: row.name,
    role: row.role,
    ...(row.role === 'owner' ? { rootRef: row.root_ref } : {}),
  }))
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

  async create(space: {
    rootRef: string
    name: string
    owner: Identity
    ownerAccount?: string
  }): Promise<boolean> {
    const at = this.#at()
    const { owner } = space
    const ownerAccount = space.ownerAccount ?? (await accountOf(this.#db, owner, true, this.#now()))
    const made = await this.#db
      .prepare(
        `INSERT OR IGNORE INTO teams
          (space_id, name, owner_email, created_at, updated_at, root_ref, owner_provider, owner_sub, owner_account_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        this.#id,
        space.name,
        owner.email.toLowerCase(),
        at,
        at,
        space.rootRef,
        owner.provider,
        owner.sub,
        ownerAccount
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
    const direct = identity.provider === SESSION_PROVIDER ? identity.sub : null
    // (one round trip: every request asks. A session's identity is the account itself; a login's account is
    // looked up. A row the previous Worker made, with no account yet, is still found by the login's key)
    const row = await this.#db
      .prepare(
        `SELECT CASE WHEN t.owner_provider || ':' || t.owner_sub = ?
                       OR (acct.id IS NOT NULL AND t.owner_account_id = acct.id)
                     THEN 'owner' ELSE m.role END AS role
          FROM teams t
          LEFT JOIN (SELECT COALESCE(?, (SELECT account_id FROM account_identities WHERE provider = ? AND sub = ?)) AS id) acct ON 1
          LEFT JOIN team_members m ON m.space_id = t.space_id
            AND (m.identity = ? OR (acct.id IS NOT NULL AND m.account_id = acct.id))
          WHERE t.space_id = ? AND t.ended_at IS NULL`
      )
      .bind(key, direct, identity.provider, identity.sub, key, this.#id)
      .first<{ role: TeamRole | null }>()
    return row?.role ?? null
  }

  async members(): Promise<TeamMember[]> {
    const info = await this.info()
    if (!info) return []
    const [{ results: rows }, { results: addresses }] = await Promise.all([
      this.#sql(
        'SELECT email, role, account_id FROM team_members WHERE space_id = ? ORDER BY email'
      ).all<{ email: string; role: MemberRole; account_id: string | null }>(),
      this.#sql(
        'SELECT account_id, email FROM team_member_emails WHERE space_id = ? ORDER BY email'
      ).all<{ account_id: string; email: string }>(),
    ])
    const known = new Map<string, string[]>()
    for (const { account_id, email } of addresses) {
      known.set(account_id, [...(known.get(account_id) ?? []), email])
    }
    return [
      { email: info.owner.email, emails: [info.owner.email], role: 'owner' },
      ...rows.map(row => {
        // (the primary address first, and always there, as an older app reads `email`)
        const others = (row.account_id ? known.get(row.account_id) : undefined) ?? []
        return {
          email: row.email,
          emails: [row.email, ...others.filter(each => each !== row.email)],
          role: row.role,
        }
      }),
    ]
  }

  /** The keys of every login of the account a member row belongs to (a row with no account: just its own) */
  async #loginsOf(accountId: string | null, key: string): Promise<string[]> {
    if (!accountId) return [key]
    const { results } = await this.#db
      .prepare("SELECT provider || ':' || sub AS key FROM account_identities WHERE account_id = ?")
      .bind(accountId)
      .all<{ key: string }>()
    // (a device signed in with a session is a socket under the account's own key)
    return [...new Set([key, `${SESSION_PROVIDER}:${accountId}`, ...results.map(row => row.key)])]
  }

  /** Close the live sockets of every login of a member: what they may do has changed */
  async #dropMember(member: { identity: string; account_id: string | null }): Promise<void> {
    for (const key of await this.#loginsOf(member.account_id, member.identity)) {
      await this.#drop(key)
    }
  }

  /**
   * The member of this space that this login is: by its account, or by its key for a row the
   * previous Worker made, which has no account yet
   */
  async #memberOf(
    identity: Identity,
    accountId: string | null
  ): Promise<{ identity: string; account_id: string | null } | null> {
    return this.#sql(
      `SELECT identity, account_id FROM team_members
        WHERE space_id = ? AND (identity = ? OR (? IS NOT NULL AND account_id = ?))`,
      identityKey(identity),
      accountId,
      accountId
    ).first<{ identity: string; account_id: string | null }>()
  }

  async setMember(
    identity: Identity,
    role: MemberRole,
    options: { invitedAs?: string } = {}
  ): Promise<void> {
    const info = await this.info()
    if (!info) throw new Error('No such space')
    const accountId = (await accountOf(this.#db, identity, true, this.#now())) as string
    if (
      identityKey(info.owner) === identityKey(identity) ||
      (await this.#ownerAccount()) === accountId
    ) {
      throw new Error('The owner is not a member: their role cannot be changed')
    }
    const email = identity.email.toLowerCase()
    const invitedAs = options.invitedAs?.trim().toLowerCase()
    const member = await this.#memberOf(identity, accountId)
    // (the member's key stays the first login's: a second login of the account is the same member)
    const key = member?.identity ?? identityKey(identity)
    await this.#db.batch([
      this.#sql(
        `INSERT INTO team_members (space_id, identity, email, role, since, account_id) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (space_id, identity)
          DO UPDATE SET email = excluded.email, role = excluded.role, account_id = excluded.account_id`,
        key,
        email,
        role,
        this.#at(),
        accountId
      ),
      // (a verified sign-in address is theirs, whatever else the team had noted for it)
      this.#sql(
        `INSERT INTO team_member_emails (space_id, email, account_id, source) VALUES (?, ?, ?, 'signin')
          ON CONFLICT (space_id, email) DO UPDATE SET account_id = excluded.account_id, source = 'signin'`,
        email,
        accountId
      ),
      // (an address another member has is theirs: it is not taken by the label of an invite)
      ...(invitedAs && invitedAs !== email
        ? [
            this.#sql(
              `INSERT OR IGNORE INTO team_member_emails (space_id, email, account_id, source)
                VALUES (?, ?, ?, 'invite')`,
              invitedAs,
              accountId
            ),
          ]
        : []),
    ])
    await this.#dropMember({ identity: key, account_id: accountId })
  }

  /** The account that owns this space (null for a space the previous Worker made, before accounts) */
  async #ownerAccount(): Promise<string | null> {
    const row = await this.#sql('SELECT owner_account_id FROM teams WHERE space_id = ?').first<{
      owner_account_id: string | null
    }>()
    return row?.owner_account_id ?? null
  }

  /** Forget a member: the membership and every address the team had for them */
  async #forget(member: { identity: string; account_id: string | null }): Promise<void> {
    const logins = await this.#loginsOf(member.account_id, member.identity)
    await this.#db.batch([
      this.#sql('DELETE FROM team_members WHERE space_id = ? AND identity = ?', member.identity),
      ...(member.account_id
        ? [
            this.#sql(
              'DELETE FROM team_member_emails WHERE space_id = ? AND account_id = ?',
              member.account_id
            ),
          ]
        : []),
    ])
    for (const key of logins) await this.#drop(key)
  }

  async removeMember(identity: Identity): Promise<void> {
    const accountId = await accountOf(this.#db, identity, false)
    const member = await this.#memberOf(identity, accountId)
    if (member) await this.#forget(member)
    else await this.#drop(identityKey(identity))
  }

  /** The member this address is one of (the address they signed in with, or one the team noted) */
  async #byEmail(email: string): Promise<{ identity: string; account_id: string | null } | null> {
    const address = email.toLowerCase()
    return this.#sql(
      `SELECT m.identity, m.account_id FROM team_members m
        WHERE m.space_id = ?
          AND (m.email = ?
               OR m.account_id IN (SELECT account_id FROM team_member_emails WHERE space_id = ? AND email = ?))`,
      address,
      this.#id,
      address
    ).first<{ identity: string; account_id: string | null }>()
  }

  async setRoleByEmail(email: string, role: MemberRole): Promise<boolean> {
    const member = await this.#byEmail(email)
    if (!member) return false
    await this.#db
      .prepare('UPDATE team_members SET role = ? WHERE space_id = ? AND identity = ?')
      .bind(role, this.#id, member.identity)
      .run()
    await this.#dropMember(member)
    return true
  }

  async removeByEmail(email: string): Promise<boolean> {
    const member = await this.#byEmail(email)
    if (!member) return false
    await this.#forget(member)
    return true
  }

  async createInvite(role: MemberRole, email: string, by: Identity) {
    // (invites that have run out are only hidden from the list: they go when the next is made)
    await this.#db.prepare('DELETE FROM team_invites WHERE expires_at < ?').bind(this.#at()).run()
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

  async markInviteEmailed(code: string): Promise<void> {
    await this.#db
      .prepare('UPDATE team_invites SET emailed_at = ? WHERE id = ? AND space_id = ?')
      .bind(this.#at(), await hashOf(code), this.#id)
      .run()
  }

  async invites(): Promise<InviteInfo[]> {
    const { results } = await this.#sql(
      `SELECT id, email, role, created_by, created_at, expires_at, emailed_at FROM team_invites
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
      emailedAt: row.emailed_at,
    }))
  }

  async revokeInvite(id: string): Promise<boolean> {
    const gone = await this.#sql('DELETE FROM team_invites WHERE space_id = ? AND id = ?', id).run()
    return gone.meta.changes > 0
  }

  async inviteInfo(
    code: string
  ): Promise<{ teamName: string; role: MemberRole; email: string } | null> {
    const row = await this.#sql(
      `SELECT i.email, i.role, i.expires_at, t.name FROM team_invites i
        JOIN teams t ON t.space_id = i.space_id
        WHERE i.space_id = ? AND i.id = ? AND t.ended_at IS NULL`,
      await hashOf(code)
    ).first<{ email: string; role: MemberRole; expires_at: string; name: string }>()
    if (!row || row.expires_at <= this.#at()) return null
    return { teamName: row.name, role: row.role, email: row.email }
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
    // (Google verified the account's email at sign-in. An invite for an admin is for that address
    // alone: the role is too much to hand to whoever has the link. Any other is for whoever has it,
    // and the address is kept as theirs, so the people who know them by it still do)
    const theirs = identity.email.toLowerCase() === invite.email
    if (!theirs && invite.role === 'admin') return 'other-account'
    await this.setMember(identity, invite.role, theirs ? {} : { invitedAs: invite.email })
    if (!theirs) {
      await this.#event('joined_as_other', identity.email, { invitedAs: invite.email }).run()
    }
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
      this.#sql('DELETE FROM team_member_emails WHERE space_id = ?'),
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
