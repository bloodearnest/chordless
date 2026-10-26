/**
 * A share's live room (docs/LIVE_SYNC.md, "Share links"): one Durable Object per share file, named
 * by its file id, for the devices live on a share to tell each other that it was updated.
 *
 * This only claims the class, its binding and its migration, so that they are deployed (and a
 * migration cannot be taken back) before the code that uses them. It answers 501 until then.
 */
/* v8 ignore start -- needs `cloudflare:workers`: only workerd has it (worker.node.test.ts runs it there, unmeasured) */
import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env.ts'

export class ShareRoom extends DurableObject<Env> {
  fetch(): Response {
    return new Response('Not yet', { status: 501 })
  }
}
/* v8 ignore stop */
