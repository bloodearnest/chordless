/**
 * The Chordless session (docs/SPACES.md, "Sign-in"): what a device holds once it has signed in, whichever
 * way, and what the Worker accepts as proof of who is asking.
 *
 * - An **access token**: a short-lived JWT, signed with `SESSION_SIGNING_KEY` and checked without a database
 *   read. Its subject is the account.
 * - A **refresh token**, `<session id>.<secret>`, which makes the next pair. Only a hash of the secret is
 *   kept (the `sessions` table, migration 0004), and it is **replaced each time it is used**. One that is
 *   presented again after it was replaced is a stolen copy, or a device that lost an answer: within a few
 *   seconds it is taken for the second (and replaced again); after that the whole session is ended.
 *
 * Nothing here knows how the person signed in: the routes that do (session.ts) call it with an account.
 */
import * as jose from 'jose'
import { toBase64Url } from '../../src/js/base64url.ts'
import { sha256Hex } from '../../src/js/utils/bytes.ts'
import type { D1Db } from './d1.ts'

/** The `iss` of an access token: how a bearer token is told from a provider's (identity.ts) */
export const SESSION_ISSUER = 'chordless'
const AUDIENCE = 'chordless'
/** How long an access token lasts, which is also the longest a revoked session is still believed */
export const ACCESS_TTL_SECONDS = 15 * 60
/** A session that is not used for this long ends (the clock restarts at each use: it is a sliding window) */
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000
/** A replaced refresh token presented again within this long is a retry, not theft */
export const RETRY_GRACE_MS = 30_000

/** How long a revoked session's row is kept */
export const REVOKED_KEPT_MS = 30 * 24 * 60 * 60 * 1000

export interface SessionKey {
  /** Base64, 32 random bytes: the key access tokens are signed with */
  SESSION_SIGNING_KEY: string
}

/** What a device is given, and keeps */
export interface SessionTokens {
  access_token: string
  refresh_token: string
  /** Seconds until the access token ends */
  expires_in: number
}

/** Who an access token is for */
export interface SessionClaims {
  accountId: string
  sessionId: string
  email: string
}

const signingKey = (env: SessionKey): Uint8Array =>
  Uint8Array.from(atob(env.SESSION_SIGNING_KEY), character => character.charCodeAt(0))

/** The access token for a session (a test makes one for an account it set up) */
export async function signAccessToken(
  claims: SessionClaims,
  env: SessionKey,
  now: Date = new Date()
): Promise<string> {
  return new jose.SignJWT({ sid: claims.sessionId, email: claims.email })
    .setProtectedHeader({ alg: 'HS256', kid: '1' })
    .setIssuer(SESSION_ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.accountId)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + ACCESS_TTL_SECONDS)
    .sign(signingKey(env))
}

/** Who an access token is for; null for one that is not ours, is changed, or has ended */
export async function verifyAccessToken(
  token: string,
  env: SessionKey,
  now: Date = new Date()
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jose.jwtVerify(token, signingKey(env), {
      algorithms: ['HS256'],
      issuer: SESSION_ISSUER,
      audience: AUDIENCE,
      currentDate: now,
      requiredClaims: ['sub', 'sid', 'exp'],
    })
    return {
      accountId: payload.sub as string,
      sessionId: payload.sid as string,
      email: payload.email as string,
    }
  } catch {
    return null
  }
}

interface SessionRow {
  session_id: string
  account_id: string
  email: string
  token_hash: string
  previous_hash: string | null
  rotated_at: string | null
  expires_at: string
  revoked_at: string | null
}

/** A refresh token's two parts, or null for text that is not one */
function parts(refreshToken: string): { sessionId: string; secret: string } | null {
  const match = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/.exec(refreshToken)
  return match ? { sessionId: match[1], secret: match[2] } : null
}

const newSecret = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(32)))

/**
 * Two hashes are the same. They are both sha256 of a secret of 256 random bits, so how long a comparison
 * takes says nothing that helps to find one.
 */
const same = (a: string, b: string): boolean => a === b

async function pair(
  env: SessionKey,
  claims: SessionClaims,
  secret: string,
  now: Date
): Promise<SessionTokens> {
  return {
    access_token: await signAccessToken(claims, env, now),
    refresh_token: `${claims.sessionId}.${secret}`,
    expires_in: ACCESS_TTL_SECONDS,
  }
}

/** A new session for an account that has just proved who it is: its first pair of tokens */
export async function issueSession(
  db: D1Db,
  env: SessionKey,
  who: { accountId: string; email: string },
  now: Date = new Date()
): Promise<SessionTokens> {
  // (sessions that have run out, and ones revoked a month ago, go when the next is made; a revoked session is kept
  // for a while so that its tokens are refused as revoked, not as unknown)
  await db
    .prepare('DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?')
    .bind(now.toISOString(), new Date(now.getTime() - REVOKED_KEPT_MS).toISOString())
    .run()
  const sessionId = [...crypto.getRandomValues(new Uint8Array(16))]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
  const secret = newSecret()
  const at = now.toISOString()
  await db
    .prepare(
      `INSERT INTO sessions (session_id, account_id, email, token_hash, created_at, last_used_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      sessionId,
      who.accountId,
      who.email.toLowerCase(),
      await sha256Hex(secret),
      at,
      at,
      new Date(now.getTime() + REFRESH_TTL_MS).toISOString()
    )
    .run()
  return pair(
    env,
    { accountId: who.accountId, sessionId, email: who.email.toLowerCase() },
    secret,
    now
  )
}

/** What `rotateSession` says */
export type Rotation =
  | { ok: true; tokens: SessionTokens; accountId: string; email: string }
  | { ok: false; why: 'invalid' | 'reused' }

/**
 * Use a refresh token: the next pair, and the one presented is no longer good. An unknown, ended or revoked
 * session, or a secret that is not its, is `invalid`. A secret that was replaced: within the grace it was a
 * retry, and is answered like the first (and replaced again); after it the session is revoked and the answer
 * is `reused`, so that a copy that was taken stops working for both the thief and the owner, who signs in again.
 */
export async function rotateSession(
  db: D1Db,
  env: SessionKey,
  refreshToken: string,
  now: Date = new Date()
): Promise<Rotation> {
  const given = parts(refreshToken)
  if (!given) return { ok: false, why: 'invalid' }
  const row = await db
    .prepare(
      `SELECT session_id, account_id, email, token_hash, previous_hash, rotated_at, expires_at, revoked_at
        FROM sessions WHERE session_id = ?`
    )
    .bind(given.sessionId)
    .first<SessionRow>()
  const at = now.toISOString()
  if (!row || row.revoked_at || row.expires_at <= at) return { ok: false, why: 'invalid' }

  const hash = await sha256Hex(given.secret)
  const current = same(hash, row.token_hash)
  const previous = row.previous_hash !== null && same(hash, row.previous_hash)
  if (!current && !previous) return { ok: false, why: 'invalid' }
  if (
    previous &&
    (row.rotated_at === null || now.getTime() - Date.parse(row.rotated_at) > RETRY_GRACE_MS)
  ) {
    await db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE session_id = ?')
      .bind(at, row.session_id)
      .run()
    return { ok: false, why: 'reused' }
  }

  const secret = newSecret()
  // (only if it is still as it was read: two uses at once make one new pair, and the other is told it was not)
  const changed = await db
    .prepare(
      `UPDATE sessions SET previous_hash = token_hash, token_hash = ?, rotated_at = ?, last_used_at = ?, expires_at = ?
        WHERE session_id = ? AND token_hash = ? AND revoked_at IS NULL`
    )
    .bind(
      await sha256Hex(secret),
      at,
      at,
      new Date(now.getTime() + REFRESH_TTL_MS).toISOString(),
      row.session_id,
      row.token_hash
    )
    .run()
  if (changed.meta.changes === 0) return { ok: false, why: 'invalid' }
  return {
    ok: true,
    accountId: row.account_id,
    email: row.email,
    tokens: await pair(
      env,
      { accountId: row.account_id, sessionId: row.session_id, email: row.email },
      secret,
      now
    ),
  }
}

/** End a session by its refresh token (signing out); false for one that is not good (nothing to end) */
export async function revokeSession(
  db: D1Db,
  refreshToken: string,
  now: Date = new Date()
): Promise<boolean> {
  const given = parts(refreshToken)
  if (!given) return false
  const row = await db
    .prepare('SELECT token_hash, previous_hash FROM sessions WHERE session_id = ?')
    .bind(given.sessionId)
    .first<{ token_hash: string; previous_hash: string | null }>()
  if (!row) return false
  const hash = await sha256Hex(given.secret)
  if (
    !same(hash, row.token_hash) &&
    !(row.previous_hash !== null && same(hash, row.previous_hash))
  ) {
    return false
  }
  const ended = await db
    .prepare('UPDATE sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL')
    .bind(now.toISOString(), given.sessionId)
    .run()
  return ended.meta.changes > 0
}
