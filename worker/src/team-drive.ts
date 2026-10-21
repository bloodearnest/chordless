/**
 * How the Worker reaches a team space's Drive (docs/SPACES.md, "Credentials: two ways to back a
 * team space"). The Drive code is the app's own (`createDriveStorage`, src/js/storage), given
 * access tokens by a source instead of the signed-in user: here, the owner's, made from the
 * encrypted blob the space's Durable Object holds. A service account would be another source.
 *
 * Access tokens are made on demand and kept in this isolate's memory, for their hour at most;
 * nothing is stored. A blob is opened only to make one.
 */
import { createDriveApi } from '../../src/js/drive-client.ts'
import { createDriveStorage } from '../../src/js/storage/drive-storage.ts'
import type { StorageBackend } from '../../src/js/storage/types.ts'
import { type BlobData, type BlobKey, decryptBlob } from './blob.ts'
import type { GoogleEnv, refreshAccessToken } from './google-auth.ts'
import type { SpaceInfo, TeamSpaceApi } from './team-state.ts'

/** A problem with the space's credential that its members can be told of (the status is passed on) */
export class CredentialError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'CredentialError'
    this.status = status
  }
}

/** A token this close to its end is made again */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000

interface Made {
  token: Promise<string>
  /** ms */
  expiresAt: number
}

/** The access tokens made so far in this isolate, by the blob's id; memory only */
const made = new Map<string, Made>()

export interface OwnerTokenOptions {
  room: Pick<TeamSpaceApi, 'ownerBlob'>
  info: SpaceInfo
  env: BlobKey & GoogleEnv
  /** What reaches Google, and the clock: the real ones, or a test's */
  google: { refreshAccessToken: typeof refreshAccessToken }
  now: () => number
}

/**
 * Where a space's Drive calls get their access token: the owner's, from the blob in the space's
 * Durable Object. Many calls at once (a batch) make one token between them.
 */
export function ownerAccessToken({
  room,
  info,
  env,
  google,
  now,
}: OwnerTokenOptions): () => Promise<string> {
  // (opened once for the calls of this source, a batch's many; tried again if it failed)
  let opened: Promise<BlobData> | undefined
  const open = (): Promise<BlobData> => {
    opened ??= (async () => {
      const blob = await room.ownerBlob()
      if (!blob) throw new CredentialError('Sharing is not set up for this space', 409)
      const data = await decryptBlob(blob, env)
      // (a blob that is not the owner's must not stand in for their access)
      if (data.owner_sub !== info.owner.sub) {
        throw new CredentialError('The stored Google sign-in is not the space owner’s', 409)
      }
      return data
    })()
    opened.catch(() => {
      opened = undefined
    })
    return opened
  }

  return async () => {
    const data = await open()

    const known = made.get(data.blob_id)
    if (known && known.expiresAt - now() > EXPIRY_BUFFER_MS) return known.token

    // (until Google answers, the token being made stands for the callers that come meanwhile)
    const entry: Made = {
      expiresAt: Number.POSITIVE_INFINITY,
      token: google.refreshAccessToken(data.refresh_token, env).then(
        ({ access_token, expires_in }) => {
          entry.expiresAt = now() + (expires_in ?? 0) * 1000
          return access_token
        },
        error => {
          made.delete(data.blob_id)
          if ((error as { error?: string }).error === 'invalid_grant') {
            throw new CredentialError('The space owner needs to reconnect Google Drive', 409)
          }
          throw error
        }
      ),
    }
    for (const [id, each] of made) if (each.expiresAt <= now()) made.delete(id)
    made.set(data.blob_id, entry)
    return entry.token
  }
}

/** The storage API on Drive for a team space, whose access tokens come from `getAccessToken` */
export function teamDrive(
  getAccessToken: () => Promise<string>,
  fetch?: typeof globalThis.fetch
): StorageBackend {
  return createDriveStorage(createDriveApi({ getAccessToken, fetch }))
}
