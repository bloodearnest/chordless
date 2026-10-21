/**
 * Who is asking the team space API (docs/SPACES.md, "Setting up and joining a team space").
 *
 * A request carries an identity provider's ID token as `Authorization: Bearer`. Each provider
 * says which issuers it answers for and how to verify a token; nothing past `authenticate` knows
 * which provider was used. Google is the only one. The token says who someone is, not what they
 * may do: roles are the space's (the Durable Object's).
 */
import * as jose from 'jose'
import { type GoogleEnv, ISSUERS, verifyIdToken } from './google-auth.ts'

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

/** The key a member is stored under: `sub` is unique only within a provider */
export function identityKey({ provider, sub }: Identity): string {
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

/** Who is asking, from the request's `Authorization: Bearer` token; null if it names no one */
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
  return provider ? provider.verify(match[1]) : null
}
