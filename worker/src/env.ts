import type { RateLimit } from './email.ts'
import type { GoogleEnv } from './google-auth.ts'
import type { ShareEnv } from './share.ts'
import type { TeamSpaceApi } from './team-state.ts'

/** The worker's bindings, variables and secrets (see wrangler.toml) */
export interface Env extends GoogleEnv, ShareEnv {
  /** The team spaces' Durable Objects, one per space, named by the space's id (team-space.ts): unset in tests that do not touch team spaces */
  TEAM_SPACE?: {
    idFromName(name: string): unknown
    get(id: unknown): TeamSpaceApi
  }
  /** The live rooms of shares, one per share file, named by its id (share-room.ts): unset in tests that do not touch them */
  SHARE_ROOM?: {
    idFromName(name: string): unknown
    get(id: unknown): { fetch(request: Request): Response | Promise<Response> }
  }
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
  /**
   * The browser key for the Google Picker (folder choice for a team space). Public by nature (it
   * works for the Picker API only, from our own addresses), kept here beside the other keys so
   * it is set in one place; the page asks for it at `/api/config`
   */
  PICKER_API_KEY?: string
  /** Base64 AES-256 key for the token blobs */
  JWE_ENCRYPTION_KEY: string
}
