/**
 * What a team space's Durable Object knows (docs/SPACES.md, "Setting up and joining a team space"):
 * who owns the space, who its members are and their roles, which Drive files are in its tree, and
 * the owner's encrypted token blob. It holds **no song, setlist or pad content**: only these
 * records (CLAUDE.md, "Spaces and copyright"). Every method takes and returns plain data, so the
 * Durable Object (`team-space.ts`) is a thin wrapper and the rules are tested in Node.
 *
 * Members are keyed by `identityKey` (provider and sub), not by email: an email is for showing and
 * for matching an invite, but it is the account that is a member.
 */
import type { InviteInfo, MemberRole, TeamMember, TeamRole } from '../../src/js/team-roles.ts'
import { type Identity, identityKey } from './identity.ts'

/** The part of a Durable Object's storage this uses, so a test can give it a Map */
export interface Store {
  get<T>(key: string): Promise<T | undefined>
  /** (Cloudflare takes up to 128 entries in one put) */
  put(entries: Record<string, unknown>): Promise<void>
  delete(key: string): Promise<boolean>
  /** Everything in the object */
  deleteAll(): Promise<void>
  list<T>(options: { prefix: string }): Promise<Map<string, T>>
}

export interface SpaceInfo {
  /** Drive's id of the space's folder (or a shared drive's folder) */
  rootRef: string
  name: string
  owner: Identity
  createdAt: string
}

interface InviteRecord {
  email: string
  role: MemberRole
  createdBy: string
  createdAt: string
  expiresAt: string
}

/** The hash an invite is kept under: the code is a secret, so it is not stored */
async function hashOf(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** A new code: 128 random bits, as URL-safe text */
function newCode(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

interface MemberRecord {
  email: string
  role: MemberRole
  since: string
}

/** How long an invite can be used */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** What the Durable Object answers to the Worker: also the shape of its stub */
export interface TeamSpaceApi {
  /** Make the space; false (and nothing changed) if it already exists */
  create(space: { rootRef: string; name: string; owner: Identity }): Promise<boolean>
  info(): Promise<SpaceInfo | null>
  /** This account's role in the space, or null if it is not a member */
  roleOf(identity: Identity): Promise<TeamRole | null>
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
  /** Forget the space entirely: its members, invites, files and the owner's blob */
  destroy(): Promise<void>
  /** Note that these files are in the space's tree (they stay noted when binned); repeats are free */
  addRefs(refs: string[]): Promise<void>
  owns(ref: string): Promise<boolean>
  /** Those of these refs that are in the space's tree (a feed of changes covers more than the space) */
  ownedAmong(refs: string[]): Promise<string[]>
  /** The owner's token blob, as encrypted by the Worker's key; null if there is none */
  ownerBlob(): Promise<string | null>
  setOwnerBlob(blob: string): Promise<void>
  clearOwnerBlob(): Promise<void>
}

const SPACE = 'space'
const BLOB = 'ownerBlob'
const MEMBER = 'member:'
const REF = 'ref:'
const INVITE = 'invite:'
/** Cloudflare's limit on the entries of one put */
const PUT_LIMIT = 128

export class TeamSpaceState implements TeamSpaceApi {
  #store: Store
  #now: () => Date

  constructor(store: Store, now: () => Date = () => new Date()) {
    this.#store = store
    this.#now = now
  }

  async create(space: { rootRef: string; name: string; owner: Identity }): Promise<boolean> {
    if (await this.info()) return false
    const info: SpaceInfo = {
      ...space,
      owner: { ...space.owner, email: space.owner.email.toLowerCase() },
      createdAt: this.#now().toISOString(),
    }
    await this.#store.put({ [SPACE]: info })
    return true
  }

  async info(): Promise<SpaceInfo | null> {
    return (await this.#store.get<SpaceInfo>(SPACE)) ?? null
  }

  async roleOf(identity: Identity): Promise<TeamRole | null> {
    const info = await this.info()
    if (!info) return null
    if (identityKey(info.owner) === identityKey(identity)) return 'owner'
    const member = await this.#store.get<MemberRecord>(MEMBER + identityKey(identity))
    return member?.role ?? null
  }

  async members(): Promise<TeamMember[]> {
    const info = await this.info()
    if (!info) return []
    const records = [...(await this.#store.list<MemberRecord>({ prefix: MEMBER })).values()]
    records.sort((a, b) => a.email.localeCompare(b.email))
    return [
      { email: info.owner.email, role: 'owner' },
      ...records.map(({ email, role }) => ({ email, role })),
    ]
  }

  async setMember(identity: Identity, role: MemberRole): Promise<void> {
    const info = await this.info()
    if (!info) throw new Error('No such space')
    if (identityKey(info.owner) === identityKey(identity)) {
      throw new Error('The owner is not a member: their role cannot be changed')
    }
    const key = MEMBER + identityKey(identity)
    const known = await this.#store.get<MemberRecord>(key)
    const record: MemberRecord = {
      email: identity.email.toLowerCase(),
      role,
      since: known?.since ?? this.#now().toISOString(),
    }
    await this.#store.put({ [key]: record })
  }

  async removeMember(identity: Identity): Promise<void> {
    await this.#store.delete(MEMBER + identityKey(identity))
  }

  /** The member with this email: their key and record */
  async #byEmail(email: string): Promise<[string, MemberRecord] | null> {
    const wanted = email.toLowerCase()
    const all = await this.#store.list<MemberRecord>({ prefix: MEMBER })
    return [...all].find(([, record]) => record.email === wanted) ?? null
  }

  async setRoleByEmail(email: string, role: MemberRole): Promise<boolean> {
    const found = await this.#byEmail(email)
    if (!found) return false
    await this.#store.put({ [found[0]]: { ...found[1], role } })
    return true
  }

  async removeByEmail(email: string): Promise<boolean> {
    const found = await this.#byEmail(email)
    return found ? this.#store.delete(found[0]) : false
  }

  async createInvite(role: MemberRole, email: string, by: Identity) {
    const code = newCode()
    const created = this.#now()
    const record: InviteRecord = {
      email: email.trim().toLowerCase(),
      role,
      createdBy: by.email.toLowerCase(),
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + INVITE_TTL_MS).toISOString(),
    }
    await this.#store.put({ [INVITE + (await hashOf(code))]: record })
    return { code, expiresAt: record.expiresAt }
  }

  async invites(): Promise<InviteInfo[]> {
    const now = this.#now().toISOString()
    const all = await this.#store.list<InviteRecord>({ prefix: INVITE })
    return [...all]
      .filter(([, record]) => record.expiresAt > now)
      .map(([key, record]) => ({ id: key.slice(INVITE.length), ...record }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  revokeInvite(id: string): Promise<boolean> {
    return this.#store.delete(INVITE + id)
  }

  async redeemInvite(code: string, identity: Identity): Promise<TeamRole | 'other-account' | null> {
    const key = INVITE + (await hashOf(code))
    const invite = await this.#store.get<InviteRecord>(key)
    if (!invite || invite.expiresAt <= this.#now().toISOString()) return null
    const current = await this.roleOf(identity)
    if (current) return current
    // (Google verified the account's email at sign-in: the invite is for whoever has that address)
    if (identity.email.toLowerCase() !== invite.email) return 'other-account'
    await this.setMember(identity, invite.role)
    await this.#store.delete(key)
    return invite.role
  }

  async destroy(): Promise<void> {
    await this.#store.deleteAll()
  }

  async addRefs(refs: string[]): Promise<void> {
    // (a listing repeats the same refs every sync: only the ones not yet noted are written)
    const known = await this.#store.list<boolean>({ prefix: REF })
    const fresh = [...new Set(refs)].filter(ref => !known.has(REF + ref))
    for (let start = 0; start < fresh.length; start += PUT_LIMIT) {
      const entries = fresh.slice(start, start + PUT_LIMIT).map(ref => [REF + ref, true] as const)
      await this.#store.put(Object.fromEntries(entries))
    }
  }

  async owns(ref: string): Promise<boolean> {
    return (await this.#store.get<boolean>(REF + ref)) === true
  }

  async ownedAmong(refs: string[]): Promise<string[]> {
    if (refs.length === 0) return []
    const known = await this.#store.list<boolean>({ prefix: REF })
    return refs.filter(ref => known.has(REF + ref))
  }

  async ownerBlob(): Promise<string | null> {
    return (await this.#store.get<string>(BLOB)) ?? null
  }

  async setOwnerBlob(blob: string): Promise<void> {
    await this.#store.put({ [BLOB]: blob })
  }

  async clearOwnerBlob(): Promise<void> {
    await this.#store.delete(BLOB)
  }
}
