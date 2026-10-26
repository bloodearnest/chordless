/**
 * A share's live room (docs/LIVE_SYNC.md, "Share links"): one Durable Object per share file, named
 * by its file id. The sharer's device says "changed" after it has uploaded the share, and the
 * recipients who are live on it fetch it again. Like a team space's channel it carries only that
 * word, so there is no content to hold; all the object keeps is the hash of the secret the sharer
 * proved on first use, and that goes after a while. Recipients have no account, so listening needs
 * only the file id, which is in their link.
 */
/* v8 ignore start -- needs `cloudflare:workers`: only workerd has it (worker.node.test.ts runs it there, unmeasured) */
import { DurableObject, type DurableObjectState } from 'cloudflare:workers'
import { CHANGED, LIVE_PROTOCOL, PING, PONG } from '../../src/js/live-protocol.ts'
import type { Env } from './env.ts'
import { judgeSender } from './live-relay.ts'

/** The sockets one room takes: a share is for a congregation, and anyone with the link may listen */
export const MAX_LISTENERS = 500
/** The sharer's claim is forgotten this long after they last connected */
const CLAIM_TTL_MS = 48 * 60 * 60 * 1000
const CLAIM = 'publisher'

/** What is kept with each socket */
interface ShareAttachment {
  publisher: boolean
}

export class ShareRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  /**
   * A device joining: the Worker has checked the id and passes the hash of the secret the device
   * gave, if it gave one (`X-Share-Publisher`). The first secret seen is the sharer's; a different
   * one later is refused, so a recipient cannot send for them
   */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a live socket', { status: 426 })
    }
    if (this.ctx.getWebSockets().length >= MAX_LISTENERS) {
      return new Response('This share has all the listeners it takes', { status: 503 })
    }
    const secret = request.headers.get('X-Share-Publisher')
    if (secret) {
      const claimed = await this.ctx.storage.get<string>(CLAIM)
      if (claimed === undefined) await this.ctx.storage.put({ [CLAIM]: secret })
      else if (claimed !== secret) return new Response('Not the sharer', { status: 403 })
      await this.ctx.storage.setAlarm(Date.now() + CLAIM_TTL_MS)
    }
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ publisher: Boolean(secret) } satisfies ShareAttachment)
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': LIVE_PROTOCOL },
    })
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const { publisher } = ws.deserializeAttachment() as ShareAttachment
    const verdict = judgeSender(publisher, message)
    if (verdict !== 'relay') {
      ws.close(verdict.close, verdict.reason)
      return
    }
    for (const other of this.ctx.getWebSockets()) if (other !== ws) other.send(CHANGED)
  }

  webSocketClose(ws: WebSocket, code: number): void {
    ws.close(code === 1005 ? 1000 : code)
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll()
  }
}
/* v8 ignore stop */
