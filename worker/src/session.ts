/**
 * The sign-in and session routes: exchanging an authorization code for an encrypted token blob,
 * refreshing an access token from it, and revoking it at sign-out.
 * Each takes the request and returns the response, so they run in Node as well as in the Worker;
 * `google` is the calls to Google, which a test replaces.
 */

import { type BlobData, decryptBlob, encryptBlob } from './blob.ts'
import type { Env } from './env.ts'
import { exchangeCode, refreshAccessToken, revokeToken, verifyIdToken } from './google-auth.ts'
import { jsonResponse, message } from './http.ts'

/** The calls to Google that the routes make */
export interface GoogleApi {
  exchangeCode: typeof exchangeCode
  refreshAccessToken: typeof refreshAccessToken
  revokeToken: typeof revokeToken
  verifyIdToken: typeof verifyIdToken
}

export const realGoogle: GoogleApi = {
  exchangeCode,
  refreshAccessToken,
  revokeToken,
  verifyIdToken,
}

/**
 * POST /oauth/callback
 *
 * Exchange authorization code for tokens, encrypt refresh token into JWE blob.
 *
 * Request body:
 * {
 *   code: string            // OAuth authorization code
 * }
 *
 * Response:
 * {
 *   blob: string,           // JWE-encrypted token blob
 *   access_token: string,   // Short-lived access token
 *   expires_in: number,     // Access token TTL (seconds)
 *   id_token: string,       // Google's ID token (who signed in)
 *   scope: string,          // What was granted: the Drive scope is absent if its box was unticked
 *   user: {...}             // The profile Google gave
 * }
 */
export async function handleOAuthCallback(
  request: Request,
  env: Env,
  google: GoogleApi = realGoogle
) {
  const body = await request.json()
  const { code, redirect_uri } = body

  if (!code) {
    return jsonResponse({ error: 'Missing code' }, 400)
  }

  // Use the redirect_uri supplied by the client (its own origin), falling back to the
  // env var. The client passes its origin so this works from localhost, Tailscale, etc.
  const redirectUri = redirect_uri || env.GOOGLE_REDIRECT_URI
  if (!redirectUri) {
    return jsonResponse({ error: 'Missing redirect_uri' }, 400)
  }

  // Exchange code for tokens; the ID token is verified (signature, issuer, audience, expiry)
  const tokens = await google.exchangeCode(code, redirectUri, env)
  const { refresh_token, access_token, expires_in, scope, id_token, claims: payload } = tokens

  if (!id_token || !payload) {
    return jsonResponse({ error: 'No ID token received. Make sure to request openid scope.' }, 400)
  }
  const email = payload.email as string | undefined
  const sub = payload.sub

  // (Drive is not required: a member of a team space signs in for who they are, and the page
  // asks for Drive separately if they want a space of their own. `scope` says what was granted.)
  if (!refresh_token) {
    return jsonResponse(
      { error: 'No refresh token received. User may need to revoke and re-authorize.' },
      400
    )
  }

  // Create JWE blob
  const blobData: BlobData = {
    owner_email: email,
    owner_sub: sub,
    scopes: scope ?? '',
    refresh_token: refresh_token,
    created_at: new Date().toISOString(),
    blob_id: crypto.randomUUID(),
    kid: 'default', // Key ID for rotation
  }

  const blob = await encryptBlob(blobData, env)

  const user = {
    name: payload.name || null,
    email: payload.email || null,
    picture: payload.picture || null,
    given_name: payload.given_name || null,
    family_name: payload.family_name || null,
    sub: payload.sub || null,
  }

  return jsonResponse({
    blob,
    access_token,
    expires_in,
    id_token,
    scope,
    user,
  })
}

/**
 * POST /session/refresh
 *
 * Refresh access token using encrypted blob.
 * Client calls this when their access token expires.
 *
 * The encrypted blob itself proves ownership (only the authorized user has it),
 * so ID token verification is optional for this endpoint.
 *
 * Request body:
 * {
 *   blob: string,              // Encrypted token blob
 *   id_token: string (optional) // ID token for extra verification (not required)
 * }
 *
 * Response:
 * {
 *   access_token: string,   // New short-lived access token
 *   expires_in: number,     // Access token TTL (seconds)
 *   id_token?: string       // A new ID token, if Google sent one: what the team space API takes
 * }
 */
export async function handleTokenRefresh(
  request: Request,
  env: Env,
  google: GoogleApi = realGoogle
) {
  const { blob, id_token } = await request.json()

  if (!blob) {
    return jsonResponse({ error: 'Missing blob' }, 400)
  }

  // Optional: Verify ID token if provided (extra security layer)
  if (id_token) {
    try {
      const payload = await google.verifyIdToken(id_token, env)

      // Decrypt blob
      const blobData = await decryptBlob(blob, env)

      // Verify ownership matches ID token
      if (blobData.owner_email !== payload.email || blobData.owner_sub !== payload.sub) {
        return jsonResponse({ error: 'Token mismatch: blob owner does not match ID token' }, 403)
      }
    } catch (error) {
      // If ID token verification fails, continue without it (blob is still valid proof)
      console.warn('ID token verification failed, proceeding with blob only:', message(error))
    }
  }

  // Decrypt blob and refresh access token
  const blobData = await decryptBlob(blob, env)

  try {
    const { access_token, expires_in, id_token } = await google.refreshAccessToken(
      blobData.refresh_token,
      env
    )
    return jsonResponse({
      access_token,
      expires_in,
      // (Google sends a new ID token with a refresh when it was asked for `openid`)
      ...(id_token ? { id_token } : {}),
    })
  } catch (error) {
    // Google no longer honours the refresh token (it expired, e.g. the consent screen is still
    // in "Testing", or the access was revoked): the user has to sign in again, which is
    // expected and not a server error
    if ((error as { error?: string }).error === 'invalid_grant') {
      return jsonResponse(
        { error: 'invalid_grant', message: 'Google sign-in expired or was revoked' },
        401
      )
    }
    throw error
  }
}

/**
 * POST /session/logout
 *
 * Revoke the refresh token in the blob at Google, so signing out ends Chordless's access to the
 * Drive and does not only forget it on this device. The blob proves ownership, as for a refresh.
 * Other devices signed in with the same Google account may need to sign in again.
 *
 * Request body: { blob: string }
 * Response: { success: true }, or 502 if Google could not be asked or refused
 */
export async function handleSessionLogout(
  request: Request,
  env: Env,
  google: GoogleApi = realGoogle
) {
  const { blob } = await request.json()
  if (!blob) {
    return jsonResponse({ error: 'Missing blob' }, 400)
  }

  let blobData: BlobData
  try {
    blobData = await decryptBlob(blob, env)
  } catch {
    return jsonResponse({ error: 'Invalid blob' }, 400)
  }

  try {
    await google.revokeToken(blobData.refresh_token, env)
  } catch (error) {
    // (Google says invalid_token for one that is already revoked: that is what was wanted)
    if ((error as { error?: string }).error !== 'invalid_token') {
      return jsonResponse(
        { error: 'Google did not revoke the access', details: message(error) },
        502
      )
    }
  }
  return jsonResponse({ success: true })
}
