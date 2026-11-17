/**
 * Who is asking the team space API (docs/SPACES.md, "Setting up and joining a team space").
 *
 * A request carries the Chordless session's access token as `Authorization: Bearer` (session-tokens.ts):
 * the Worker's own, signed, whichever way the person signed in. Each provider says which issuers it
 * answers for and how to verify a token; nothing past `authenticate` knows which was used. The token says
 * who someone is, not what they may do: roles are the space's (kept in D1). A **Google ID token** is no
 * longer a bearer (it was, before sessions): it is answered `update_required`, which is an app that has not
 * reloaded since the move (`SESSION_PROVIDER`; the move is forced, with no period of accepting both).
 */
import * as jose from 'jose'
import { type GoogleEnv, ISSUERS, verifyIdToken } from './google-auth.ts'
import { Refusal } from './http.ts'
import { SESSION_ISSUER, type SessionKey, verifyAccessToken } from './session-tokens.ts'

/** Who a verified token is for */
export interface Identity {
  /** Which provider vouched for them: members are keyed by this and `sub`, not by `sub` alone */
  provider: string
  /** The provider's stable id for the account (unique only within the provider) */
  sub: string
  /** Verified by the provider, lower case */
  email: string
}

export interface IdentityProvider {
  id: string
  /** The `iss` values of the tokens it verifies: how a token is matched to its provider */
  issuers: string[]
  /** Who the token is for; null if it is invalid or expired, or its email is not verified */
  verify(token: string): Promise<Identity | null>
}

/** The provider of an identity that comes from a session: its `sub` is the account itself, not a login of one */
/**
 * What an app from before sessions is told when it sends a Google ID token. It shows the reason the Worker gives, as
 * it is, so this is a sentence for a person: the app that reads it is the old one, which cannot be changed.
 */
export const UPDATE_REQUIRED = 'Chordless has been updated: reload this page to carry on'

export const SESSION_PROVIDER = 'chordless'

/** The key a member is stored under: `sub` is unique only within a provider */
export function identityKey({ provider, sub }: Pick<Identity, 'provider' | 'sub'>): string {
  return `${provider}:${sub}`
}

/** Google. `keys` is for tests: it replaces Google's signing keys */
export function googleProvider(env: GoogleEnv, keys?: jose.JWTVerifyGetKey): IdentityProvider {
  return {
    id: 'google',
    issuers: ISSUERS,
    async verify(token) {
      try {
        const { email, email_verified, sub } = await verifyIdToken(token, env, keys)
        return typeof email === 'string' && email_verified === true && sub
          ? { provider: 'google', sub, email: email.toLowerCase() }
          : null
      } catch {
        return null
      }
    },
  }
}

/** The Chordless session: an access token the Worker signed, whose subject is an account */
export function sessionProvider(env: SessionKey): IdentityProvider {
  return {
    id: SESSION_PROVIDER,
    issuers: [SESSION_ISSUER],
    async verify(token) {
      const claims = await verifyAccessToken(token, env)
      return claims
        ? { provider: SESSION_PROVIDER, sub: claims.accountId, email: claims.email }
        : null
    },
  }
}

/**
 * Who is asking, from the request's `Authorization: Bearer` token; null if it names no one. Throws a
 * `Refusal` (401 `update_required`) for a Google ID token, which an app from before sessions sends.
 */
export async function authenticate(
  request: Request,
  providers: IdentityProvider[]
): Promise<Identity | null> {
  const match = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')
  if (!match) return null
  let issuer: unknown
  try {
    issuer = jose.decodeJwt(match[1]).iss
  } catch {
    return null
  }
  // (the issuer picks the provider; the provider then checks everything, the issuer included)
  const provider = providers.find(each => each.issuers.some(name => name === issuer))
  if (!provider && ISSUERS.some(name => name === issuer)) throw new Refusal(401, UPDATE_REQUIRED)
  return provider ? provider.verify(match[1]) : null
}
