/**
 * The sign-in and session routes: exchanging an authorization code for an encrypted token blob,
 * refreshing an access token from it, and the (not yet used) invite and revoke of Drive access.
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

const realGoogle: GoogleApi = { exchangeCode, refreshAccessToken, revokeToken, verifyIdToken }

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
 *   expires_in: number      // Access token TTL (seconds)
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

  if (!refresh_token) {
    return jsonResponse(
      { error: 'No refresh token received. User may need to revoke and re-authorize.' },
      400
    )
  }

  // Validate that Drive scope was granted
  const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/drive.file'
  if (!scope?.includes(REQUIRED_SCOPE)) {
    return jsonResponse(
      {
        error:
          'Drive access not granted. Please re-authorize and ensure you grant access to Google Drive files.',
        granted_scopes: scope || '',
      },
      400
    )
  }

  // Create JWE blob
  const blobData: BlobData = {
    owner_email: email,
    owner_sub: sub,
    scopes: scope,
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
 *   expires_in: number      // Access token TTL (seconds)
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
    const { access_token, expires_in } = await google.refreshAccessToken(
      blobData.refresh_token,
      env
    )
    return jsonResponse({ access_token, expires_in })
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

/**
 * POST /session/invite
 *
 * Add a user as a reader to a Google Drive file.
 *
 * Request body:
 * {
 *   blob: string,         // Encrypted token blob
 *   id_token: string,     // Current ID token to verify ownership
 *   file_id: string,      // Drive file ID to share
 *   email: string         // Email to invite
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   permission_id: string
 * }
 */
export async function handleSessionInvite(
  request: Request,
  env: Env,
  google: GoogleApi = realGoogle
) {
  const { blob, id_token, file_id, email } = await request.json()

  if (!blob || !id_token || !file_id || !email) {
    return jsonResponse({ error: 'Missing required fields' }, 400)
  }

  // Verify ID token
  const payload = await google.verifyIdToken(id_token, env)

  // Decrypt blob
  const blobData = await decryptBlob(blob, env)

  // Verify ownership
  if (blobData.owner_email !== payload.email || blobData.owner_sub !== payload.sub) {
    return jsonResponse({ error: 'Token mismatch: blob owner does not match ID token' }, 403)
  }

  // Refresh access token (needs client secret)
  const { access_token: accessToken } = await google.refreshAccessToken(blobData.refresh_token, env)

  // Call Drive API to add permission
  const driveResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file_id}/permissions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'user',
        emailAddress: email,
      }),
    }
  )

  if (!driveResponse.ok) {
    const error = await driveResponse.text()
    return jsonResponse({ error: 'Drive API error', details: error }, driveResponse.status)
  }

  const result = await driveResponse.json()

  return jsonResponse({
    success: true,
    permission_id: result.id,
  })
}

/**
 * POST /session/revoke
 *
 * Remove a user's permission from a Google Drive file.
 *
 * Request body:
 * {
 *   blob: string,           // Encrypted token blob
 *   id_token: string,       // Current ID token to verify ownership
 *   file_id: string,        // Drive file ID
 *   permission_id: string   // Permission ID to revoke
 * }
 *
 * Response:
 * {
 *   success: boolean
 * }
 */
export async function handleSessionRevoke(
  request: Request,
  env: Env,
  google: GoogleApi = realGoogle
) {
  const { blob, id_token, file_id, permission_id } = await request.json()

  if (!blob || !id_token || !file_id || !permission_id) {
    return jsonResponse({ error: 'Missing required fields' }, 400)
  }

  // Verify ID token
  const payload = await google.verifyIdToken(id_token, env)

  // Decrypt blob
  const blobData = await decryptBlob(blob, env)

  // Verify ownership
  if (blobData.owner_email !== payload.email || blobData.owner_sub !== payload.sub) {
    return jsonResponse({ error: 'Token mismatch: blob owner does not match ID token' }, 403)
  }

  // Refresh access token (needs client secret)
  const { access_token: accessToken } = await google.refreshAccessToken(blobData.refresh_token, env)

  // Call Drive API to remove permission
  const driveResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file_id}/permissions/${permission_id}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (!driveResponse.ok && driveResponse.status !== 204) {
    const error = await driveResponse.text()
    return jsonResponse({ error: 'Drive API error', details: error }, driveResponse.status)
  }

  return jsonResponse({ success: true })
}
