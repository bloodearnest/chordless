/**
 * Talking to Google's OAuth server, with libraries that do the protocol work:
 * oauth4webapi for the token endpoint (code exchange, refresh) and jose for checking ID
 * tokens. Nothing here parses or checks a token by hand.
 *
 * Both are fetch-based, so they run in the Worker without Node's http module (which
 * google-auth-library needs, and the Vite plugin's workerd does not provide).
 */

import * as jose from 'jose'
import * as oauth from 'oauth4webapi'

const ISSUER = 'https://accounts.google.com'
// Google also issues ID tokens with the issuer written without the scheme
export const ISSUERS = [ISSUER, 'accounts.google.com']
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOCATION_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs'
const TIMEOUT_MS = 10_000

/** The two secrets the token endpoint and the ID token check need */
export interface GoogleEnv {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

const authorizationServer: oauth.AuthorizationServer = {
  issuer: ISSUER,
  token_endpoint: TOKEN_ENDPOINT,
  revocation_endpoint: REVOCATION_ENDPOINT,
  jwks_uri: JWKS_URI,
  id_token_signing_alg_values_supported: ['RS256'],
}

// Fetches Google's signing keys, and caches them (jose honours the cache headers)
const googleKeys = jose.createRemoteJWKSet(new URL(JWKS_URI), { timeoutDuration: TIMEOUT_MS })

/** What tests replace: the fetch that reaches Google's token endpoint, and Google's signing keys */
export interface GoogleTestHooks {
  fetch?: typeof fetch
  keys?: jose.JWTVerifyGetKey
}

const requestOptions = ({ fetch }: GoogleTestHooks) => ({
  signal: AbortSignal.timeout(TIMEOUT_MS),
  ...(fetch && { [oauth.customFetch]: fetch }),
})

/**
 * Verify a Google ID token: signature (against Google's keys, RS256 only), issuer, audience
 * (this app's client id) and expiry. Throws if any is wrong; returns the claims.
 * `keys` is for tests: it replaces Google's signing keys.
 */
export async function verifyIdToken(
  idToken: string,
  env: GoogleEnv,
  keys: jose.JWTVerifyGetKey = googleKeys
) {
  const { payload } = await jose.jwtVerify(idToken, keys, {
    algorithms: ['RS256'],
    issuer: ISSUERS,
    audience: env.GOOGLE_CLIENT_ID,
    requiredClaims: ['exp', 'iat', 'sub'],
  })
  return payload
}

/**
 * Exchange the authorization code from the sign-in popup for tokens.
 * Returns { refresh_token, access_token, expires_in, scope, id_token, claims }, where
 * claims are the verified ID token's.
 */
export async function exchangeCode(
  code: string,
  redirectUri: string,
  env: GoogleEnv,
  hooks: GoogleTestHooks = {}
) {
  const client: oauth.Client = { client_id: env.GOOGLE_CLIENT_ID }
  const clientAuth = oauth.ClientSecretPost(env.GOOGLE_CLIENT_SECRET)

  // The sign-in popup sends no `state` and no PKCE verifier, so there are none to check
  const params = oauth.validateAuthResponse(
    authorizationServer,
    client,
    new URLSearchParams({ code }),
    oauth.expectNoState
  )
  const response = await oauth.authorizationCodeGrantRequest(
    authorizationServer,
    client,
    clientAuth,
    params,
    redirectUri,
    oauth.nopkce,
    requestOptions(hooks)
  )
  const tokens = await oauth.processAuthorizationCodeResponse(authorizationServer, client, response)

  if (!tokens.id_token) return { ...tokens, claims: null }
  return { ...tokens, claims: await verifyIdToken(tokens.id_token, env, hooks.keys) }
}

/** Get a new access token with a refresh token. Returns { access_token, expires_in }. */
export async function refreshAccessToken(
  refreshToken: string,
  env: GoogleEnv,
  hooks: GoogleTestHooks = {}
) {
  const client: oauth.Client = { client_id: env.GOOGLE_CLIENT_ID }
  const clientAuth = oauth.ClientSecretPost(env.GOOGLE_CLIENT_SECRET)

  const response = await oauth.refreshTokenGrantRequest(
    authorizationServer,
    client,
    clientAuth,
    refreshToken,
    requestOptions(hooks)
  )
  return oauth.processRefreshTokenResponse(authorizationServer, client, response)
}

/**
 * Revoke a refresh token at Google, which ends this app's access to the account's Drive (for
 * every access token made from it). Throws if Google refuses; a token that is already revoked
 * is `invalid_token` (error.error). The endpoint needs no client secret, so none is sent.
 */
export async function revokeToken(
  token: string,
  env: GoogleEnv,
  hooks: GoogleTestHooks = {}
): Promise<void> {
  const client: oauth.Client = { client_id: env.GOOGLE_CLIENT_ID }
  const response = await oauth.revocationRequest(
    authorizationServer,
    client,
    oauth.None(),
    token,
    requestOptions(hooks)
  )
  await oauth.processRevocationResponse(response)
}
