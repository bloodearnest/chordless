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
const ISSUERS = [ISSUER, 'accounts.google.com']
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs'
const TIMEOUT_MS = 10_000

const authorizationServer = {
  issuer: ISSUER,
  token_endpoint: TOKEN_ENDPOINT,
  jwks_uri: JWKS_URI,
  id_token_signing_alg_values_supported: ['RS256'],
}

// Fetches Google's signing keys, and caches them (jose honours the cache headers)
const googleKeys = jose.createRemoteJWKSet(new URL(JWKS_URI), { timeoutDuration: TIMEOUT_MS })

const requestOptions = () => ({ signal: AbortSignal.timeout(TIMEOUT_MS) })

/**
 * Verify a Google ID token: signature (against Google's keys, RS256 only), issuer, audience
 * (this app's client id) and expiry. Throws if any is wrong; returns the claims.
 * `keys` is for tests: it replaces Google's signing keys.
 */
export async function verifyIdToken(idToken, env, keys = googleKeys) {
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
export async function exchangeCode(code, redirectUri, env) {
  const client = { client_id: env.GOOGLE_CLIENT_ID }
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
    requestOptions()
  )
  const tokens = await oauth.processAuthorizationCodeResponse(authorizationServer, client, response)

  if (!tokens.id_token) return { ...tokens, claims: null }
  return { ...tokens, claims: await verifyIdToken(tokens.id_token, env) }
}

/** Get a new access token with a refresh token. Returns { access_token, expires_in }. */
export async function refreshAccessToken(refreshToken, env) {
  const client = { client_id: env.GOOGLE_CLIENT_ID }
  const clientAuth = oauth.ClientSecretPost(env.GOOGLE_CLIENT_SECRET)

  const response = await oauth.refreshTokenGrantRequest(
    authorizationServer,
    client,
    clientAuth,
    refreshToken,
    requestOptions()
  )
  return oauth.processRefreshTokenResponse(authorizationServer, client, response)
}
