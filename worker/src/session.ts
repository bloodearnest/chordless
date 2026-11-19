/**
 * The sign-in and session routes: exchanging an authorization code for Google's tokens (kept for the account as an encrypted
 * blob), the Chordless session, and ending it at sign-out.
 * Each takes the request and returns the response, so they run in Node as well as in the Worker;
 * `google` is the calls to Google, which a test replaces.
 */

import { cleanName } from './account.ts'
import { grantsDrive, keepDrive } from './account-drive.ts'
import { type BlobData, decryptBlob, encryptBlob, UnreadableBlob } from './blob.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import { type GoogleApi, realGoogle } from './google-auth.ts'
import { jsonResponse, Refusal, readJson, refusing } from './http.ts'
import {
  issueSession,
  revokeSession,
  rotateSession,
  type SessionTokens,
  verifyAccessToken,
} from './session-tokens.ts'
import { accountOf, claimAddress } from './team-state.ts'
import { annotateRequest } from './trace.ts'

/** The account behind the session a request carries as its bearer, if it carries a good one */
async function bearerAccount(request: Request, env: Env, now: Date): Promise<string | undefined> {
  const token = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1]
  if (!token || !env.SESSION_SIGNING_KEY) return undefined
  return (await verifyAccessToken(token, env, now))?.accountId
}

/**
 * The account for a Google login that has just proved who it is:
 * - signed in already (a session as the bearer): the login joins that account, as an explicit link (a person who
 *   signed in with an emailed code connects Google, whatever address it has); 409 `google_in_use` if the login is
 *   already on another account (two accounts are not merged, here);
 * - not: the login's own account; and a new login whose address Google says it has verified, and that an emailed
 *   code has proved for an account, joins that account (the same mailbox is the same person); otherwise a new one.
 */
async function accountOfGoogle(
  db: D1Db,
  who: { sub: string; email: string; verified: boolean; name?: string },
  linkTo: string | undefined,
  now: Date
): Promise<string> {
  const at = now.toISOString()
  const email = who.email.toLowerCase()
  const existing = await db
    .prepare("SELECT account_id FROM account_identities WHERE provider = 'google' AND sub = ?")
    .bind(who.sub)
    .first<{ account_id: string }>()
  if (existing && linkTo && existing.account_id !== linkTo) {
    throw new Refusal(409, 'google_in_use')
  }
  if (linkTo && !existing) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO account_identities (provider, sub, account_id, email, created_at, last_seen_at)
          VALUES ('google', ?, ?, ?, ?, ?)`
      )
      .bind(who.sub, linkTo, email, at, at)
      .run()
  }
  // (a login that is new joins the account that owns its address, if Google verified the address: the same
  // mailbox is the same person. One that is not verified makes its own, and claims nothing)
  const accountId =
    linkTo ??
    ((await accountOf(
      db,
      { provider: 'google', sub: who.sub, email },
      true,
      now,
      who.verified
    )) as string)
  if (linkTo && who.verified) await claimAddress(db, accountId, email, now)
  // (the name Google gave is the name they have until they give another: it never replaces one they gave)
  const name = cleanName(who.name)
  if (name) {
    await db
      .prepare('UPDATE accounts SET name = ? WHERE account_id = ? AND name IS NULL')
      .bind(name, accountId)
      .run()
  }
  return accountId
}

/**
 * A new Chordless session for a Google login that has just proved who it is (a code exchanged, or a blob that
 * Google still honours): its account is found or made, and its first tokens issued. Undefined where there is no
 * database or no signing key (a development Worker without them): the sign-in then works as it did, and the
 * page has no session to use.
 */
async function startSession(
  env: Env,
  who: { sub: string; email: string; verified: boolean; name?: string },
  now: Date,
  linkTo?: string
): Promise<{ session: SessionTokens; accountId: string } | undefined> {
  if (!env.DB || !env.SESSION_SIGNING_KEY) return undefined
  const accountId = await accountOfGoogle(env.DB, who, linkTo, now)
  return {
    session: await issueSession(env.DB, env, { accountId, email: who.email }, now),
    accountId,
  }
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
 * Exchange authorization code for tokens, encrypt the refresh token into a JWE blob, and keep it for the account
 * (docs/ACCOUNT.md, "Google Drive"): it is never sent to the page.
 *
 * Request body:
 * {
 *   code: string            // OAuth authorization code
 * }
 *
 * Response:
 * {
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

    const started = await startSession(
      env,
      {
        sub: sub as string,
        email: email ?? '',
        verified: payload.email_verified === true,
        name: typeof payload.name === 'string' ? payload.name : undefined,
      },
      now,
      await bearerAccount(request, env, now)
    )
    const session = started?.session
    annotateRequest({ 'chordless.auth.session_result': session ? 'issued' : 'unavailable' })
    // A sign-in with Drive is the account's Drive connection, kept here for every device it signs in on
    if (started && env.DB && grantsDrive(scope)) {
      await keepDrive(
        env.DB,
        started.accountId,
        { blob, email: email ?? '', scope: scope as string },
        now
      )
      annotateRequest({ 'chordless.auth.drive_result': 'connected' })
    }

    return jsonResponse({
      access_token,
      expires_in,
      id_token,
      scope,
      user,
      ...(session ? { session } : {}),
    })
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
    const started = await startSession(
      env,
      { sub: blobData.owner_sub as string, email: blobData.owner_email as string, verified: false },
      now
    )
    annotateRequest({ 'chordless.auth.session_result': 'upgraded' })
    return jsonResponse(started?.session)
  })
}

/**
 * POST /session/logout
 *
 * End the session whose refresh token this is, so that signing out ends it here and not only on the device. It touches nothing at
 * Google: the account's Google Drive connection is the account's (docs/ACCOUNT.md, "Google Drive"), kept until it is disconnected.
 *
 * Request body: { refresh_token: string }
 * Response: { success: true }
 */
export function handleSessionLogout(request: Request, env: Env): Promise<Response> {
  return refusing(async () => {
    const refreshToken = textField(await readJson(request), 'refresh_token')
    if (refreshToken && env.DB) await revokeSession(env.DB, refreshToken)
    return jsonResponse({ success: true })
  })
}
