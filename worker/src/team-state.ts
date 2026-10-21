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
import type { SpaceMember } from '../../src/js/data-types.ts'
import { type Identity, identityKey } from './identity.ts'
import type { Role } from './team-api.ts'

/** The part of a Durable Object's storage this uses, so a test can give it a Map */
export interface Store {
  get<T>(key: string): Promise<T | undefined>
  /** (Cloudflare takes up to 128 entries in one put) */
  put(entries: Record<string, unknown>): Promise<void>
  delete(key: string): Promise<boolean>
  list<T>(options: { prefix: string }): Promise<Map<string, T>>
}

/** The roles a member can hold: the owner is not a member, they are the space's */
export type MemberRole = Exclude<Role, 'owner'>

export interface SpaceInfo {
  /** Drive's id of the space's folder (or a shared drive's folder) */
  rootRef: string
  name: string
  owner: Identity
  createdAt: string
}

interface MemberRecord {
  email: string
  role: MemberRole
  since: string
}

/** What the Durable Object answers to the Worker: also the shape of its stub */
export interface TeamSpaceApi {
  /** Make the space; false (and nothing changed) if it already exists */
  create(space: { rootRef: string; name: string; owner: Identity }): Promise<boolean>
  info(): Promise<SpaceInfo | null>
  /** This account's role in the space, or null if it is not a member */
  roleOf(identity: Identity): Promise<Role | null>
  /** The owner first, then the members by email */
  members(): Promise<SpaceMember[]>
  /** Add a member, or change their role */
  setMember(identity: Identity, role: MemberRole): Promise<void>
  removeMember(identity: Identity): Promise<void>
  /** Note that these files are in the space's tree (they stay noted when binned); repeats are free */
  addRefs(refs: string[]): Promise<void>
  owns(ref: string): Promise<boolean>
  /** The owner's token blob, as encrypted by the Worker's key; null if there is none */
  ownerBlob(): Promise<string | null>
  setOwnerBlob(blob: string): Promise<void>
  clearOwnerBlob(): Promise<void>
}

const SPACE = 'space'
const BLOB = 'ownerBlob'
const MEMBER = 'member:'
const REF = 'ref:'
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

  async roleOf(identity: Identity): Promise<Role | null> {
    const info = await this.info()
    if (!info) return null
    if (identityKey(info.owner) === identityKey(identity)) return 'owner'
    const member = await this.#store.get<MemberRecord>(MEMBER + identityKey(identity))
    return member?.role ?? null
  }

  async members(): Promise<SpaceMember[]> {
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
