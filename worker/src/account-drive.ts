/**
 * An account's Google Drive connection, kept at the Worker (docs/ACCOUNT.md, "Google Drive"): one encrypted refresh-token
 * blob per account (D1 `account_drive`), so any device that is signed in can ask for a Drive access token.
 *
 * - `POST /api/account/drive/token`: a new Drive access token for the account (404 `not_connected` if there is none; 401
 *   `invalid_grant` if Google no longer honours it, which is one Reconnect for every device)
 * - `POST /api/account/drive/adopt {blob}`: a device that holds a blob from before this keeps it here, once
 * - `DELETE /api/account/drive`: disconnect: revoked at Google and forgotten, for every device
 *
 * All need a Chordless session. The Google callback stores the blob itself (`keepDrive`).
 */
import { type BlobData, decryptBlob, UnreadableBlob } from './blob.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import { type GoogleApi, realGoogle } from './google-auth.ts'
import { jsonResponse, message, Refusal, readJson, refusing } from './http.ts'
import { authenticate, SESSION_PROVIDER, sessionProvider } from './identity.ts'
import { annotateRequest } from './trace.ts'

export const DRIVE_PATH = '/api/account/drive'

/** The scope that makes a Google sign-in a Drive connection */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

/** What is said about the connection (the blob never leaves the Worker) */
export interface DriveInfo {
  /** The Google account Drive is reached as */
  email: string
}

/** Whether what Google granted includes Drive */
export function grantsDrive(scope: string | undefined): boolean {
  return !!scope?.split(' ').includes(DRIVE_SCOPE)
}

/** The account's Drive connection, if it has one */
export async function driveInfo(db: D1Db, accountId: string): Promise<DriveInfo | null> {
  const row = await db
    .prepare('SELECT google_email FROM account_drive WHERE account_id = ?')
    .bind(accountId)
    .first<{ google_email: string }>()
  return row ? { email: row.google_email } : null
}

/** Keep (or replace) the account's Drive connection: a sign-in with Drive has just proved it */
export async function keepDrive(
  db: D1Db,
  accountId: string,
  drive: { blob: string; email: string; scope: string },
  now: Date
): Promise<void> {
  const at = now.toISOString()
  await db
    .prepare(
      `INSERT INTO account_drive (account_id, blob, google_email, scope, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (account_id) DO UPDATE SET
          blob = excluded.blob, google_email = excluded.google_email,
          scope = excluded.scope, updated_at = excluded.updated_at`
    )
    .bind(accountId, drive.blob, drive.email.toLowerCase(), drive.scope, at, at)
    .run()
}

async function whoIs(request: Request, env: Env): Promise<string> {
  const identity = await authenticate(request, [sessionProvider(env)])
  if (!identity || identity.provider !== SESSION_PROVIDER) throw new Refusal(401, 'Sign in first')
  return identity.sub
}

/** POST /api/account/drive/token, POST /api/account/drive/adopt and DELETE /api/account/drive */
export function handleDrive(
  request: Request,
  env: Env,
  google: GoogleApi = realGoogle,
  now: Date = new Date()
): Promise<Response> {
  return refusing(async () => {
    if (!env.DB || !env.SESSION_SIGNING_KEY) return jsonResponse({ error: 'Not set up' }, 503)
    const db = env.DB
    const accountId = await whoIs(request, env)
    const path = new URL(request.url).pathname

    if (request.method === 'DELETE' && path === DRIVE_PATH) {
      const row = await db
        .prepare('SELECT blob FROM account_drive WHERE account_id = ?')
        .bind(accountId)
        .first<{ blob: string }>()
      if (!row) return jsonResponse({ success: true, revoked: false })
      // A team the person owns, kept in their Drive, holds a copy of the same grant: revoking it would end the team's storage
      const owns = await db
        .prepare(
          "SELECT 1 AS found FROM teams WHERE owner_account_id = ? AND credential = 'owner' AND ended_at IS NULL"
        )
        .bind(accountId)
        .first()
      if (owns) {
        await db.prepare('DELETE FROM account_drive WHERE account_id = ?').bind(accountId).run()
        annotateRequest({ 'chordless.auth.drive_result': 'disconnected_kept_grant' })
        return jsonResponse({ success: true, revoked: false })
      }
      try {
        const data = await decryptBlob(row.blob, env)
        await google.revokeToken(data.refresh_token, env)
      } catch (error) {
        // (one that is already revoked, or that cannot be read, is what was wanted; Google not answering is not)
        const unwanted =
          error instanceof UnreadableBlob || (error as { error?: string }).error === 'invalid_token'
        if (!unwanted) {
          return jsonResponse(
            { error: 'Google did not revoke the access', details: message(error) },
            502
          )
        }
      }
      await db.prepare('DELETE FROM account_drive WHERE account_id = ?').bind(accountId).run()
      annotateRequest({ 'chordless.auth.drive_result': 'disconnected' })
      return jsonResponse({ success: true, revoked: true })
    }

    if (request.method !== 'POST') return jsonResponse({ error: 'Not found' }, 404)

    if (path === `${DRIVE_PATH}/adopt`) {
      const blob = (await readJson(request)).blob
      if (typeof blob !== 'string' || !blob) throw new Refusal(400, 'Missing blob')
      let data: BlobData
      try {
        data = await decryptBlob(blob, env)
      } catch (error) {
        if (error instanceof UnreadableBlob) throw new Refusal(401, 'invalid_blob')
        throw error
      }
      // (the blob is only this account's if its Google login is on this account: a blob is not a way to take another's)
      const owner = await db
        .prepare("SELECT account_id FROM account_identities WHERE provider = 'google' AND sub = ?")
        .bind(data.owner_sub ?? '')
        .first<{ account_id: string }>()
      if (!owner || owner.account_id !== accountId) throw new Refusal(409, 'google_in_use')
      if (!grantsDrive(data.scopes)) return jsonResponse({ adopted: false })
      // (a connection made on another device since is newer than this one: it is kept)
      const existing = await driveInfo(db, accountId)
      if (!existing) {
        await keepDrive(
          db,
          accountId,
          { blob, email: data.owner_email ?? '', scope: data.scopes },
          now
        )
      }
      annotateRequest({ 'chordless.auth.drive_result': existing ? 'adopt_kept_newer' : 'adopted' })
      return jsonResponse({ adopted: !existing })
    }

    if (path === `${DRIVE_PATH}/token`) {
      const row = await db
        .prepare('SELECT blob FROM account_drive WHERE account_id = ?')
        .bind(accountId)
        .first<{ blob: string }>()
      if (!row) return jsonResponse({ error: 'not_connected' }, 404)
      let data: BlobData
      try {
        data = await decryptBlob(row.blob, env)
      } catch (error) {
        if (error instanceof UnreadableBlob) {
          annotateRequest({ 'chordless.auth.drive_result': 'invalid_blob' })
          return jsonResponse({ error: 'invalid_blob' }, 401)
        }
        throw error
      }
      try {
        const { access_token, expires_in } = await google.refreshAccessToken(
          data.refresh_token,
          env
        )
        annotateRequest({ 'chordless.auth.drive_result': 'ok' })
        return jsonResponse({ access_token, expires_in })
      } catch (error) {
        if ((error as { error?: string }).error === 'invalid_grant') {
          annotateRequest({ 'chordless.auth.drive_result': 'invalid_grant' })
          return jsonResponse(
            { error: 'invalid_grant', message: 'Google sign-in expired or was revoked' },
            401
          )
        }
        throw error
      }
    }
    return jsonResponse({ error: 'Not found' }, 404)
  })
}
