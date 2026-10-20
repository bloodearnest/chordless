import type { RateLimit } from './email.ts'
import type { GoogleEnv } from './google-auth.ts'
import type { ShareEnv } from './share.ts'

/** The worker's bindings, variables and secrets (see wrangler.toml) */
export interface Env extends GoogleEnv, ShareEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
  /** Set only in [env.dev]: serve the component playgrounds */
  DEV_PAGES?: string
  /** Used when the client sends no redirect_uri */
  GOOGLE_REDIRECT_URI?: string
  /** Limits on the emails answered (wrangler.toml [[ratelimits]]): unset in tests and dev */
  EMAIL_PER_SENDER?: RateLimit
  EMAIL_OVERALL?: RateLimit
  /** The address links in email replies point to; chordless.app when unset */
  APP_ORIGIN?: string
  /** Spike item 7, dev only: a service account's JSON key (docs/SPACES.md) */
  SPIKE_SERVICE_ACCOUNT_KEY?: string
  /** Base64 AES-256 key for the token blobs */
  JWE_ENCRYPTION_KEY: string
}
