/**
 * The sign-in and session routes: exchanging an authorization code for an encrypted token blob,
 * refreshing an access token from it, and revoking it at sign-out.
 * Each takes the request and returns the response, so they run in Node as well as in the Worker;
 * `google` is the calls to Google, which a test replaces.
 */

import { type BlobData, decryptBlob, encryptBlob, UnreadableBlob } from './blob.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import { type GoogleApi, realGoogle } from './google-auth.ts'
import { jsonResponse, message, Refusal, readJson, refusing } from './http.ts'
import { issueSession, revokeSession, rotateSession, type SessionTokens } from './session-tokens.ts'
import { accountOf } from './team-state.ts'
import { annotateRequest } from './trace.ts'

/**
 * A new Chordless session for a Google login that has just proved who it is (a code exchanged, or a blob that
 * Google still honours): its account is found or made, and its first tokens issued. Undefined where there is no
 * database or no signing key (a development Worker without them): the sign-in then works as it did, and the
 * page has no session to use.
 */
async function startSession(
  env: Env,
  who: { sub: string; email: string },
  now: Date
): Promise<SessionTokens | undefined> {
  if (!env.DB || !env.SESSION_SIGNING_KEY) return undefined
  const accountId = (await accountOf(
    env.DB,
    { provider: 'google', sub: who.sub, email: who.email },
    true,
    now
  )) as string
  return issueSession(env.DB, env, { accountId, email: who.email }, now)
}

/** A text field of a request's body, or undefined if it is missing, empty or not text */
function textField(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name]
  return typeof value === 'string' && value ? value : undefined
}

/**
 * The blob a request sent, opened. Refused if there is none (400), or if it is not one this
 * Worker can read (401 `invalid_blob`: the page asks the person to sign in again, as for an
 * `invalid_grant`). The blob itself is the proof of who is asking.
 */
async function openBlob(body: Record<string, unknown>, env: Env): Promise<BlobData> {
  const blob = textField(body, 'blob')
  if (!blob) throw new Refusal(400, 'Missing blob')
  try {
    return await decryptBlob(blob, env)
  } catch (error) {
    if (error instanceof UnreadableBlob) {
      annotateRequest({ 'chordless.auth.refresh_result': 'invalid_blob' })
      throw new Refusal(401, 'invalid_blob')
    }
    throw error
  }
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
 *   session: {...}          // The Chordless session: { access_token, refresh_token, expires_in }
 * }
 */
export function handleOAuthCallback(
  request: Request,
  env: Env,
  google: GoogleApi = realGoogle,
  now: Date = new Date()
): Promise<Response> {
  return refusing(async () => {
    const body = await readJson(request)
    const code = textField(body, 'code')

    if (!code) {
      return jsonResponse({ error: 'Missing code' }, 400)
    }

    // Use the redirect_uri supplied by the client (its own origin), falling back to the
    // env var. The client passes its origin so this works from localhost, Tailscale, etc.
    const redirectUri = textField(body, 'redirect_uri') ?? env.GOOGLE_REDIRECT_URI
    if (!redirectUri) {
      return jsonResponse({ error: 'Missing redirect_uri' }, 400)
    }

    // Exchange code for tokens; the ID token is verified (signature, issuer, audience, expiry)
    const tokens = await google.exchangeCode(code, redirectUri, env)
    const { refresh_token, access_token, expires_in, scope, id_token, claims: payload } = tokens

    if (!id_token || !payload) {
      return jsonResponse(
        { error: 'No ID token received. Make sure to request openid scope.' },
        400
      )
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

    const session = await startSession(env, { sub: sub as string, email: email ?? '' }, now)
    annotateRequest({ 'chordless.auth.session_result': session ? 'issued' : 'unavailable' })

    return jsonResponse({
      blob,
      access_token,
      expires_in,
      id_token,
      scope,
      user,
      ...(session ? { session } : {}),
    })
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
export function handleTokenRefresh(
  request: Request,
  env: Env,
  google: GoogleApi = realGoogle
): Promise<Response> {
  return refusing(async () => {
    const body = await readJson(request)
    const blobData = await openBlob(body, env)
    // (how old the sign-in is, so that a refusal tells a week-old sign-in from a year-old one)
    const signedInAt = Date.parse(blobData.created_at)
    annotateRequest({
      'chordless.auth.blob_age_days': Number.isNaN(signedInAt)
        ? -1
        : Math.floor((Date.now() - signedInAt) / 86_400_000),
      'chordless.auth.blob_kid': blobData.kid,
    })

    // Optional: Verify ID token if provided (extra security layer)
    const idToken = textField(body, 'id_token')
    if (idToken) {
      try {
        const payload = await google.verifyIdToken(idToken, env)
        // Verify ownership matches ID token
        if (blobData.owner_email !== payload.email || blobData.owner_sub !== payload.sub) {
          return jsonResponse({ error: 'Token mismatch: blob owner does not match ID token' }, 403)
        }
      } catch (error) {
        // If ID token verification fails, continue without it (blob is still valid proof)
        console.warn('ID token verification failed, proceeding with blob only:', message(error))
      }
    }

    try {
      const { access_token, expires_in, id_token } = await google.refreshAccessToken(
        blobData.refresh_token,
        env
      )
      annotateRequest({ 'chordless.auth.refresh_result': 'ok' })
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
        // (Google's own words, "Token has been expired or revoked." or "Bad Request": no token in them)
        annotateRequest({
          'chordless.auth.refresh_result': 'invalid_grant',
          'chordless.auth.google_description': (
            (error as { error_description?: string }).error_description ?? message(error)
          ).slice(0, 200),
        })
        return jsonResponse(
          { error: 'invalid_grant', message: 'Google sign-in expired or was revoked' },
          401
        )
      }
      throw error
    }
  })
}

/** A Worker with no database or signing key cannot keep sessions (a development one without them) */
function sessionsOf(env: Env): D1Db & { signing: true } {
  if (!env.DB || !env.SESSION_SIGNING_KEY) throw new Refusal(503, 'Sessions are not set up')
  return env.DB as D1Db & { signing: true }
}

/**
 * POST /session/token
 *
 * The next pair of tokens for a refresh token (which is then spent: docs/SECURITY.md). 401 `invalid_session`
 * if it is not good (unknown, ended, revoked, or already used), and the page signs in again.
 *
 * Request body: { refresh_token: string }
 * Response: { access_token, refresh_token, expires_in }
 */
export function handleSessionToken(
  request: Request,
  env: Env,
  now: Date = new Date()
): Promise<Response> {
  return refusing(async () => {
    const body = await readJson(request)
    const refreshToken = textField(body, 'refresh_token')
    if (!refreshToken) return jsonResponse({ error: 'Missing refresh_token' }, 400)
    const db = sessionsOf(env)
    const result = await rotateSession(db, env, refreshToken, now)
    annotateRequest({ 'chordless.auth.session_result': result.ok ? 'rotated' : result.why })
    if (!result.ok) return jsonResponse({ error: 'invalid_session', reason: result.why }, 401)
    return jsonResponse(result.tokens)
  })
}

/**
 * POST /session/upgrade
 *
 * A device that is signed in with Google from before sessions has the blob, which already proves who it
 * is (as for a refresh): it gets a session for that account with no sign-in. 401 `invalid_blob` if the
 * blob cannot be read.
 *
 * Request body: { blob: string }
 * Response: { access_token, refresh_token, expires_in }
 */
export function handleSessionUpgrade(
  request: Request,
  env: Env,
  now: Date = new Date()
): Promise<Response> {
  return refusing(async () => {
    const blobData = await openBlob(await readJson(request), env)
    sessionsOf(env)
    const session = await startSession(
      env,
      { sub: blobData.owner_sub as string, email: blobData.owner_email as string },
      now
    )
    annotateRequest({ 'chordless.auth.session_result': 'upgraded' })
    return jsonResponse(session)
  })
}

/**
 * POST /session/logout
 *
 * Revoke the refresh token in the blob at Google, so signing out ends Chordless's access to the
 * Drive and does not only forget it on this device. The blob proves ownership, as for a refresh.
 * Other devices signed in with the same Google account may need to sign in again.
 *
 * Request body: { blob: string, refresh_token?: string }: the session's refresh token, if the device has
 *   one, is revoked too, so that the session ends here and not only on the device
 * Response: { success: true }, or 502 if Google could not be asked or refused
 */
export function handleSessionLogout(
  request: Request,
  env: Env,
  google: GoogleApi = realGoogle
): Promise<Response> {
  return refusing(async () => {
    const body = await readJson(request)
    const refreshToken = textField(body, 'refresh_token')
    if (refreshToken && env.DB) await revokeSession(env.DB, refreshToken)
    // (a device that only ends its session, and keeps Google's access for the others: no blob)
    if (refreshToken && !textField(body, 'blob')) return jsonResponse({ success: true })
    const blobData = await openBlob(body, env)

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
  })
}
