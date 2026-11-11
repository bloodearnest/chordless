/**
 * A team space's live room: the Durable Object that holds the sockets of the devices that are live
 * (live-relay.ts, docs/LIVE_SYNC.md), which carry only "something changed". One object per space,
 * named by the space's id. It keeps **no storage**: who the space's members are is in D1
 * (team-state.ts), asked when a socket sends. It is a Durable Object only because a WebSocket that
 * hibernates must be held by one.
 */
/* v8 ignore start -- needs `cloudflare:workers`: only workerd has it (worker.node.test.ts runs it there, unmeasured) */
import { DurableObject, type DurableObjectState } from 'cloudflare:workers'
import { CHANGED, LIVE_PROTOCOL, PING, PONG } from '../../src/js/live-protocol.ts'
import type { Env } from './env.ts'
import { identityKey } from './identity.ts'
import { judge, type LiveAttachment } from './live-relay.ts'
import { TeamSpaceState } from './team-state.ts'

export class TeamRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // The pages' pings are answered by the runtime without waking the object: a socket that is quiet
    // costs nothing, and a page can tell a dead one (no answer) from a quiet one
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  /**
   * A device going live: the Worker has settled who it is (team-live.ts) and passes that in a
   * header, which a browser's request never reaches this object with. The socket is accepted for
   * hibernation: the object is out of memory between messages, and the socket's attachment (which
   * account, in which space) is all that is known of it.
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
    const who = ws.deserializeAttachment() as LiveAttachment
    const role = this.env.DB ? await new TeamSpaceState(this.env.DB, who.spaceId).roleOf(who) : null
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

  /** Close the live sockets of an account (`provider:sub`), or all of them: the next connect is asked again */
  dropSockets(identity?: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      const who = ws.deserializeAttachment() as LiveAttachment
      if (!identity || identityKey(who) === identity) ws.close(1008, 'Membership changed')
    }
  }
}
/* v8 ignore stop */
