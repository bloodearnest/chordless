/**
 * Chordless's own Google account for team storage (docs/SPACES.md, "Credentials: two ways to back a
 * team space"): a service account, `team-storage@chordless-app.iam.gserviceaccount.com`, which a
 * team adds to its shared drive as a Content manager. Its key is the Worker secret
 * `TEAM_STORAGE_KEY` (the JSON file Google gives, made by hand: it would land in Terraform's state),
 * never in KV or a Durable Object, and can be replaced by putting a new one.
 *
 * An access token is made by signing a request with the key (RS256) and giving it to Google's token
 * endpoint, with no person present. Tokens are kept in this isolate's memory for their hour at most;
 * nothing is stored.
 */
import * as jose from 'jose'
import type { DriveApi } from '../../src/js/drive-client.ts'
import { CredentialError } from './team-drive.ts'

/** The fields of a key file that are used */
interface ServiceAccountKey {
  client_email: string
  private_key: string
  token_uri?: string
}

/** What this needs of the Worker's environment */
export interface ServiceAccountEnv {
  /** The service account's key file, as JSON; unset where team storage is not set up */
  TEAM_STORAGE_KEY?: string
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/drive'
/** A token this close to its end is made again */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000

const NOT_SET_UP = 'Team-managed storage is not set up on this server'

/** The key, or null if there is none; throws if there is one that cannot be used */
function keyOf(env: ServiceAccountEnv): ServiceAccountKey | null {
  if (!env.TEAM_STORAGE_KEY) return null
  let key: unknown
  try {
    key = JSON.parse(env.TEAM_STORAGE_KEY)
  } catch {
    throw new Error('TEAM_STORAGE_KEY is not the JSON of a key file')
  }
  const { client_email, private_key, token_uri } = (key ?? {}) as Record<string, unknown>
  if (typeof client_email !== 'string' || typeof private_key !== 'string') {
    throw new Error('TEAM_STORAGE_KEY has no client_email or private_key')
  }
  return {
    client_email,
    private_key,
    token_uri: typeof token_uri === 'string' ? token_uri : undefined,
  }
}

/** The service account's address, for a team to add to its shared drive; null if there is none */
export function serviceAccountAddress(env: ServiceAccountEnv): string | null {
  return keyOf(env)?.client_email ?? null
}

/** The signed request for an access token */
export async function signGrant(key: ServiceAccountKey, now: number): Promise<string> {
  const privateKey = await jose.importPKCS8(key.private_key, 'RS256')
  const issued = Math.floor(now / 1000)
  return new jose.SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(key.client_email)
    .setAudience(key.token_uri ?? TOKEN_URL)
    .setIssuedAt(issued)
    .setExpirationTime(issued + 3600)
    .sign(privateKey)
}

interface Made {
  token: Promise<string>
  /** ms */
  expiresAt: number
}

/** The access tokens made so far in this isolate, by the account's address; memory only */
const made = new Map<string, Made>()

/** Forget them (tests: a new key, or a clock that went back) */
export function forgetServiceAccountTokens(): void {
  made.clear()
}

export interface ServiceAccountOptions {
  env: ServiceAccountEnv
  /** What reaches Google's token endpoint: the real one (traced), or a test's */
  fetch: typeof fetch
  now: () => number
}

/**
 * Where a space's Drive calls get their access token when the space is team-managed: the service
 * account's. Many calls at once share one token.
 */
export function serviceAccountToken({
  env,
  fetch: doFetch,
  now,
}: ServiceAccountOptions): () => Promise<string> {
  return async () => {
    const key = keyOf(env)
    if (!key) throw new CredentialError(NOT_SET_UP, 409)

    const known = made.get(key.client_email)
    if (known && known.expiresAt - now() > EXPIRY_BUFFER_MS) return known.token

    // (until Google answers, the token being made stands for the callers that come meanwhile)
    const entry: Made = { expiresAt: Number.POSITIVE_INFINITY, token: Promise.resolve('') }
    entry.token = (async () => {
      const response = await doFetch(key.token_uri ?? TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: await signGrant(key, now()),
        }),
      })
      const answer = (await response.json().catch(() => ({}))) as {
        access_token?: string
        expires_in?: number
        error?: string
        error_description?: string
      }
      if (!response.ok || !answer.access_token) {
        const why = answer.error_description ?? answer.error ?? `HTTP ${response.status}`
        throw new CredentialError(`Google would not give team storage a token: ${why}`, 502)
      }
      entry.expiresAt = now() + (answer.expires_in ?? 0) * 1000
      return answer.access_token
    })()
    entry.token.catch(() => {
      if (made.get(key.client_email) === entry) made.delete(key.client_email)
    })
    for (const [id, each] of made) if (each.expiresAt <= now()) made.delete(id)
    made.set(key.client_email, entry)
    return entry.token
  }
}

/** The name of the file the check makes in a team's folder, and puts in the bin straight away */
const CHECK_FILE = 'Chordless team storage check.txt'

/**
 * Whether the service account can do the Worker's work in a team's folder: see it, make a file in
 * it, read the file back and put it in the bin (docs/SPACES.md, "Upgrade flow"). The reason it
 * cannot, said for the team's owner, or null if it can. A folder in a My Drive refuses the write
 * (a service account has no storage of its own), which is why the folder must be in a shared drive.
 */
export async function checkTeamStorage(
  api: DriveApi,
  rootRef: string,
  address: string
): Promise<string | null> {
  let folder: Awaited<ReturnType<DriveApi['getFile']>>
  try {
    folder = await api.getFile(rootRef, 'id,name,trashed,driveId,capabilities')
  } catch (error) {
    if ((error as { status?: number }).status === 403) folder = null
    else throw error
  }
  if (!folder || folder.trashed) {
    return `Chordless cannot see the Team’s folder yet: add ${address} to the shared drive the folder is in, as a Content manager`
  }
  if (!folder.driveId) {
    return 'The Team’s folder is in a My Drive: team-managed storage needs it in a Google shared drive'
  }
  if (folder.capabilities?.canAddChildren === false || folder.capabilities?.canTrash === false) {
    return `Chordless can see the Team’s folder but not change it: make ${address} a Content manager of the shared drive (Contributor is not enough)`
  }
  let made: string | null = null
  try {
    made = (
      await api.createFile(
        { name: CHECK_FILE, mimeType: 'text/plain', parents: [rootRef] },
        'Made by Chordless to check it can keep the Team’s files here. It can be deleted.'
      )
    ).id
    await api.downloadFile(made)
    await api.trashFile(made)
    made = null
  } catch (error) {
    return `Chordless could not make, read and bin a file in the Team’s folder: ${(error as Error).message}`
  } finally {
    // (a check that stopped half way leaves nothing of its own in the folder, if it can help it)
    if (made) await api.trashFile(made).catch(() => undefined)
  }
  return null
}
