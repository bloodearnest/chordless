/**
 * Chordless Auth Proxy - Cloudflare Worker
 *
 * Stateless OAuth proxy for Google Drive integration.
 * - Exchanges auth codes for tokens, encrypts refresh tokens as JWE blobs
 * - Refreshes access tokens on-demand
 * - Serves share links: the encrypted download from Drive, and the page's preview tags
 * - Performs Drive API operations (invite/revoke) on-demand with decrypted blobs
 */

/* v8 ignore start -- needs `cloudflare:email` and the Workers cache: only workerd has them (worker.node.test.ts runs it there, unmeasured) */
import { EmailMessage } from 'cloudflare:email'
import { handleEmail, type IncomingEmail } from './email.ts'
import type { Env } from './env.ts'
import { handleRequest } from './router.ts'
import type { ShareCache } from './share.ts'

/**
 * The Worker's entry: what only the Worker has (the cache, `cloudflare:email`) goes in here, and
 * the rest is in the modules it calls, which tests run in Node.
 */
export default {
  fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    return handleRequest(request, env, ctx, (caches as unknown as { default: ShareCache }).default)
  },

  /** An email sent to the import address (Cloudflare Email Routing): answered with a link */
  async email(message: IncomingEmail, env: Env) {
    await handleEmail(
      message,
      (from, to, raw) => new EmailMessage(from, to, raw),
      env.APP_ORIGIN ?? 'https://chordless.app',
      { perSender: env.EMAIL_PER_SENDER, overall: env.EMAIL_OVERALL }
    )
  },
}
/* v8 ignore stop */
