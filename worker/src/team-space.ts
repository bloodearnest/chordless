/**
 * A team space's Durable Object: its rules are `TeamSpaceState` (team-state.ts), this only gives
 * them a home in Cloudflare's storage and lets the Worker call them. One object per space, named
 * by the space's id. Holds no song, setlist or pad content.
 */
/* v8 ignore start -- needs `cloudflare:workers`: only workerd has it (worker.node.test.ts runs it there, unmeasured) */
import { DurableObject } from 'cloudflare:workers'
import type { InviteInfo, MemberRole, TeamMember, TeamRole } from '../../src/js/team-roles.ts'
import type { Env } from './env.ts'
import type { Identity } from './identity.ts'
import { type SpaceInfo, type TeamSpaceApi, TeamSpaceState } from './team-state.ts'

export class TeamSpace extends DurableObject<Env> implements TeamSpaceApi {
  #state = new TeamSpaceState(this.ctx.storage)

  create(space: { rootRef: string; name: string; owner: Identity }): Promise<boolean> {
    return this.#state.create(space)
  }
  info(): Promise<SpaceInfo | null> {
    return this.#state.info()
  }
  roleOf(identity: Identity): Promise<TeamRole | null> {
    return this.#state.roleOf(identity)
  }
  members(): Promise<TeamMember[]> {
    return this.#state.members()
  }
  setMember(identity: Identity, role: MemberRole): Promise<void> {
    return this.#state.setMember(identity, role)
  }
  removeMember(identity: Identity): Promise<void> {
    return this.#state.removeMember(identity)
  }
  createInvite(
    role: MemberRole,
    email: string,
    by: Identity
  ): Promise<{ code: string; expiresAt: string }> {
    return this.#state.createInvite(role, email, by)
  }
  invites(): Promise<InviteInfo[]> {
    return this.#state.invites()
  }
  revokeInvite(id: string): Promise<boolean> {
    return this.#state.revokeInvite(id)
  }
  redeemInvite(code: string, identity: Identity): Promise<TeamRole | 'other-account' | null> {
    return this.#state.redeemInvite(code, identity)
  }
  setRoleByEmail(email: string, role: MemberRole): Promise<boolean> {
    return this.#state.setRoleByEmail(email, role)
  }
  removeByEmail(email: string): Promise<boolean> {
    return this.#state.removeByEmail(email)
  }
  destroy(): Promise<void> {
    return this.#state.destroy()
  }
  addRefs(refs: string[]): Promise<void> {
    return this.#state.addRefs(refs)
  }
  owns(ref: string): Promise<boolean> {
    return this.#state.owns(ref)
  }
  ownedAmong(refs: string[]): Promise<string[]> {
    return this.#state.ownedAmong(refs)
  }
  ownerBlob(): Promise<string | null> {
    return this.#state.ownerBlob()
  }
  setOwnerBlob(blob: string): Promise<void> {
    return this.#state.setOwnerBlob(blob)
  }
  clearOwnerBlob(): Promise<void> {
    return this.#state.clearOwnerBlob()
  }
}
/* v8 ignore stop */
