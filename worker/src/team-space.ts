/**
 * A team space's Durable Object: its rules are `TeamSpaceState` (team-state.ts), this only gives
 * them a home in Cloudflare's storage and lets the Worker call them. One object per space, named
 * by the space's id. Holds no song, setlist or pad content. It also holds the space's live channel
 * (live-relay.ts): the sockets of the devices that are live, which carry only "something changed".
 */
/* v8 ignore start -- needs `cloudflare:workers`: only workerd has it (worker.node.test.ts runs it there, unmeasured) */
import { DurableObject, type DurableObjectState } from 'cloudflare:workers'
import { CHANGED, LIVE_PROTOCOL, PING, PONG } from '../../src/js/live-protocol.ts'
import type { InviteInfo, MemberRole, TeamMember, TeamRole } from '../../src/js/team-roles.ts'
import type { Env } from './env.ts'
import type { Identity } from './identity.ts'
import { judge, type LiveAttachment } from './live-relay.ts'
import { type SpaceInfo, type TeamSpaceApi, TeamSpaceState } from './team-state.ts'

export class TeamSpace extends DurableObject<Env> implements TeamSpaceApi {
  #state = new TeamSpaceState(this.ctx.storage)

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // The pages' pings are answered by the runtime without waking the object: a socket that is quiet
    // costs nothing, and a page can tell a dead one (no answer) from a quiet one
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  /**
   * A device going live: the Worker has settled who it is (team-live.ts) and passes that in a
   * header, which a browser's request never reaches this object with. The socket is accepted for
   * hibernation: the object is out of memory between messages, and the socket's attachment (who it
   * is) is all that is known of it.
   */
  fetch(request: Request): Response {
    const who = request.headers.get('X-Live-Identity')
    if (request.headers.get('Upgrade') !== 'websocket' || !who) {
      return new Response('Expected a live socket', { status: 426 })
    }
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment(JSON.parse(who) satisfies LiveAttachment)
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': LIVE_PROTOCOL },
    })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // (the role is the space's now, not the one the socket was opened with: a member who was
    // removed or demoted is refused at once, whether or not their socket has been closed yet)
    const role = await this.roleOf(ws.deserializeAttachment() as LiveAttachment)
    const verdict = role ? judge(role, message) : { close: 1008, reason: 'Not a member' }
    if (verdict !== 'relay') {
      ws.close(verdict.close, verdict.reason)
      return
    }
    // (the frame is not looked at again: only the one there is can get here)
    for (const other of this.ctx.getWebSockets()) if (other !== ws) other.send(CHANGED)
  }

  webSocketClose(ws: WebSocket, code: number): void {
    // (a close the other end started is answered, or the socket lingers)
    ws.close(code === 1005 ? 1000 : code)
  }

  /** Close a person's live sockets (all if no one is named): the next connect is asked again */
  #dropSockets(email?: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      const who = ws.deserializeAttachment() as LiveAttachment
      if (!email || who.email === email.toLowerCase()) ws.close(1008, 'Membership changed')
    }
  }

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
  async setMember(identity: Identity, role: MemberRole): Promise<void> {
    await this.#state.setMember(identity, role)
    this.#dropSockets(identity.email)
  }
  async removeMember(identity: Identity): Promise<void> {
    await this.#state.removeMember(identity)
    this.#dropSockets(identity.email)
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
  async setRoleByEmail(email: string, role: MemberRole): Promise<boolean> {
    const found = await this.#state.setRoleByEmail(email, role)
    this.#dropSockets(email)
    return found
  }
  async removeByEmail(email: string): Promise<boolean> {
    const found = await this.#state.removeByEmail(email)
    this.#dropSockets(email)
    return found
  }
  async destroy(): Promise<void> {
    await this.#state.destroy()
    this.#dropSockets()
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
