/**
 * Google Auth Integration using Google Identity Services (GSI)
 *
 * Vanilla JS implementation, no npm dependencies.
 * Uses GSI from CDN: https://accounts.google.com/gsi/client
 *
 * ## OAuth Authorization Flow
 *
 * 1. User clicks "Authorize with Google"
 * 2. GSI OAuth code client opens popup with scopes: drive.file, openid, email, profile
 * 3. User authorizes, popup returns authorization code
 * 4. POST code to auth proxy /oauth/callback
 * 5. Auth proxy exchanges code for tokens (including ID token) and encrypts refresh token
 * 6. Receive encrypted JWE blob containing refresh token + short-lived access token
 * 7. Store blob + metadata in Service Worker IndexedDB
 *
 * ## Direct Drive API Access
 *
 * The browser calls Google Drive API directly using the short-lived access token.
 * When the access token expires:
 *
 * 1. Client detects token expiry (checked with 5 minute buffer)
 * 2. Client calls auth proxy /session/refresh with encrypted blob + ID token
 * 3. Auth proxy decrypts blob, uses refresh token to get new access token
 * 4. Client stores new access token in Service Worker
 * 5. Client retries Drive API call with new token
 *
 * This keeps the sensitive refresh token server-side (encrypted in the blob) while
 * allowing direct browser-to-Drive API calls for better performance and offline support.
 */

import type { AuthMetadata, BlobBackup, StoredBlob, StoredUser } from './auth-db.ts'
import { jwtClaims } from './base64url.ts'

/** The signed-in user, as the UI shows them */
export interface UserInfo {
  name: string | null
  email: string | null
  picture: string | null
  avatarDataUrl: string | null
  givenName: string | null
  familyName: string | null
}

/** What the service worker answers to a message from the page */
interface WorkerReply {
  messageId?: string
  success: boolean
  error?: string
  data?: StoredBlob
  backup?: BlobBackup
}

type WorkerMessageType = 'STORE_BLOB' | 'GET_BLOB' | 'DELETE_BLOB' | 'EXPORT_BLOB' | 'IMPORT_BLOB'

// Configuration
// (the client of the Google Cloud project this build is for: .env.development / .env.production)
/* v8 ignore next -- Node (the Worker's tests) has no Vite env; the page always does */
export const GOOGLE_CLIENT_ID = import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? ''
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const IDENTITY_SCOPES = 'openid email profile'
const GOOGLE_SCOPES = `${DRIVE_SCOPE} ${IDENTITY_SCOPES}`

// The worker serves the auth routes (/oauth/*, /session/*) on the same origin as
// the app: wrangler dev locally, Tailscale serve/funnel, and production.
const AUTH_PROXY_URL = ''

/**
 * Get current user info from stored blob
 * Returns { name, email, picture } or null
 */
export async function getCurrentUserInfo(): Promise<UserInfo | null> {
  try {
    const blobData = await getStoredBlob()
    const metadata = blobData?.metadata

    if (!metadata) {
      return null
    }

    let user: StoredUser | null = metadata.user || null
    let shouldPersist = false

    if (!user && metadata.id_token) {
      const payload = jwtClaims(metadata.id_token)
      if (payload) {
        const text = (value: unknown) => (typeof value === 'string' && value ? value : null)
        user = {
          name: text(payload.name),
          email: text(payload.email),
          picture: text(payload.picture),
          given_name: text(payload.given_name),
          family_name: text(payload.family_name),
          sub: text(payload.sub),
        }
        shouldPersist = true
      }
    }

    if (!user) {
      return null
    }

    if (!user.avatarDataUrl && user.picture) {
      // (a picture that cannot be had leaves the user as they were)
      const enriched = await buildStoredUserProfile(user)
      if (enriched.avatarDataUrl) {
        user = enriched
        shouldPersist = true
      }
    }

    if (shouldPersist && blobData?.blob) {
      const updatedMetadata = {
        ...metadata,
        user,
      }
      try {
        await sendToServiceWorker('STORE_BLOB', {
          blob: blobData.blob,
          metadata: updatedMetadata,
        })
      } catch (error) {
        console.warn('[Auth] Failed to persist user metadata:', error)
      }
    }

    return formatUserInfoForUI(user)
  } catch (error) {
    logAuthFailure('Failed to get user info', error)
    return null
  }
}

/**
 * Initialize Google Identity Services
 * Call this once on page load
 */
export function initGoogleAuth(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (window.google?.accounts) {
      resolve()
      return
    }

    // Load GSI script
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      script.remove() // so trying again loads it afresh
      reject(new Error("Couldn't load Google sign-in. Are you offline?"))
    }
    document.head.appendChild(script)
  })
}

/** What the worker sends back once it has exchanged the authorization code */
export interface AuthorizeResult {
  blob: string
  access_token: string
  expires_in: number
  user: StoredUser | null
}

/** What Google is asked for: the scopes, and whether it should add the ones already granted */
interface CodeRequest {
  scope: string
  include_granted_scopes?: boolean
}

/**
 * Ask Google for an authorization code with these scopes, have the Worker exchange it for the
 * encrypted blob, and keep the sign-in. The consent screen is forced every time, so what is
 * granted is always what the person just chose (Google otherwise reuses an earlier consent).
 */
function signInWith({ scope, include_granted_scopes }: CodeRequest): Promise<AuthorizeResult> {
  return new Promise<AuthorizeResult>((resolve, reject) => {
    // access_type, prompt and include_granted_scopes are not in Google's typed config, but are sent
    const config: google.accounts.oauth2.CodeClientConfig & {
      access_type: 'offline'
      prompt: 'consent'
      include_granted_scopes?: boolean
    } = {
      client_id: GOOGLE_CLIENT_ID,
      scope,
      ux_mode: 'popup',
      access_type: 'offline',
      prompt: 'consent',
      ...(include_granted_scopes && { include_granted_scopes }),
      callback: async response => {
        try {
          if (response.error) {
            reject(new Error(response.error))
            return
          }

          // Exchange auth code for encrypted blob via auth proxy
          const blobResponse = await fetch(`${AUTH_PROXY_URL}/oauth/callback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: response.code, redirect_uri: window.location.origin }),
          })

          if (!blobResponse.ok) {
            const error = await blobResponse.json()
            throw new Error(error.error || 'Failed to exchange code for tokens')
          }

          const { blob, access_token, expires_in, id_token, scope, user } =
            await blobResponse.json()

          const normalizedUser = user ? await buildStoredUserProfile(user).catch(() => user) : null

          const metadata: AuthMetadata = {
            access_token,
            expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
            user: normalizedUser,
          }

          if (id_token) {
            metadata.id_token = id_token
          }
          if (typeof scope === 'string') {
            metadata.scope = scope
          }

          // Store blob in Service Worker: with no blob kept the user is not signed in, whatever
          // the page was told
          const stored = await sendToServiceWorker('STORE_BLOB', {
            blob,
            metadata,
          })
          if (!stored.success) throw new Error(stored.error || 'Failed to save the sign-in')

          // A new sign-in may be a different account, with different access to the folder
          import('./space-access.ts').then(({ refreshSpaceAccess }) => refreshSpaceAccess())

          resolve({ blob, access_token, expires_in, user: normalizedUser || user })
        } catch (error) {
          reject(error)
        }
      },
    }
    google.accounts.oauth2.initCodeClient(config).requestCode()
  })
}

/**
 * Sign in with Google, asking for Drive as well unless `drive` is false (someone who only wants to
 * join a team space has no use for it). Google's screen lets the Drive box be left unticked; the
 * sign-in then works without it, and `getSignInState()` says 'no-drive' until it is connected.
 */
export async function authorizeWithGoogle({
  drive = true,
}: {
  drive?: boolean
} = {}): Promise<AuthorizeResult> {
  await initGoogleAuth()
  return signInWith({ scope: drive ? GOOGLE_SCOPES : IDENTITY_SCOPES })
}

/**
 * Add Google Drive to a sign-in that has none. Drive is asked for alone, so there is no box to
 * leave unticked, and what was granted before is kept. It replaces the stored sign-in.
 */
export async function connectDrive(): Promise<AuthorizeResult> {
  await initGoogleAuth()
  return signInWith({ scope: DRIVE_SCOPE, include_granted_scopes: true })
}

/**
 * Whether the stored sign-in includes Drive (not if there is none). One made before the scope was
 * kept did, as signing in without Drive was not possible then.
 */
export async function hasDriveAccess(): Promise<boolean> {
  try {
    const stored = (await sendToServiceWorker('GET_BLOB')).data
    if (!stored) return false
    const { scope } = stored.metadata
    return scope === undefined || scope.includes(DRIVE_SCOPE)
  } catch (error) {
    logAuthFailure('Error checking for Drive access', error)
    return false
  }
}

/** Google no longer honours the stored sign-in (it expired or was revoked): sign in again */
export class SignInExpiredError extends Error {
  constructor() {
    super('Your Google sign-in has expired: connect with Google again')
    this.name = 'SignInExpiredError'
  }
}

/**
 * Where the sign-in stands: there is none ('signed-out'), it works ('signed-in'), it works but has
 * no Google Drive ('no-drive'), or it is stored but Google refuses it ('expired'). Only Google
 * saying so makes it expired: with no network, or any other failure, it is taken to work, as the
 * access token may well still be good.
 */
export type SignInState = 'signed-out' | 'signed-in' | 'no-drive' | 'expired'

export async function getSignInState(): Promise<SignInState> {
  if (!(await isAuthenticated())) return 'signed-out'
  const state = (await hasDriveAccess()) ? 'signed-in' : 'no-drive'
  try {
    await getAccessToken()
    return state
  } catch (error) {
    return error instanceof SignInExpiredError ? 'expired' : state
  }
}

/**
 * Check if user is authenticated (has blob in SW)
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    const response = await sendToServiceWorker('GET_BLOB')
    return response.success && response.data != null
  } catch (error) {
    logAuthFailure('Error checking auth status', error)
    return false
  }
}

/**
 * Get a valid access token for calling Google Drive API directly.
 * Automatically refreshes if expired.
 *
 * @returns Valid access token
 * @throws If not authenticated or refresh fails
 */
export async function getAccessToken(): Promise<string> {
  const response = await sendToServiceWorker('GET_BLOB')

  if (!response.success || !response.data) {
    throw new Error('Not authenticated - please authorize first')
  }

  const { blob, metadata } = response.data
  const expiresAt = new Date(metadata.expires_at ?? 0)
  const now = new Date()

  if (expiresAt.getTime() - now.getTime() > TOKEN_EXPIRY_BUFFER_MS) {
    // Token still valid
    return metadata.access_token ?? ''
  }

  // Token expired or about to expire, refresh it
  return (await refreshTokens(blob, metadata)).access_token
}

/**
 * Get a valid Google ID token for the team space API, which takes it as proof of who is asking
 * (worker/src/identity.ts). It never shows anything: the Worker sends a new one with each
 * refreshed access token.
 * Refreshed if it is about to expire.
 *
 * @throws If not authenticated, refresh fails, or Google sends no ID token
 */
export async function getIdentityToken(): Promise<string> {
  const response = await sendToServiceWorker('GET_BLOB')
  if (!response.success || !response.data) {
    throw new Error('Not authenticated - please authorize first')
  }
  const { blob, metadata } = response.data
  if (metadata.id_token && idTokenEnd(metadata.id_token) - Date.now() > TOKEN_EXPIRY_BUFFER_MS) {
    return metadata.id_token
  }
  const refreshed = await refreshTokens(blob, metadata)
  if (!refreshed.id_token) throw new Error('Google sent no ID token')
  return refreshed.id_token
}

/** A token this close to its end is replaced before it is used */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000

/** When an ID token ends, in ms (its own `exp` claim); 0 for one that cannot be read */
function idTokenEnd(idToken: string): number {
  return Number(jwtClaims(idToken)?.exp ?? 0) * 1000
}

/**
 * Refresh the access token (and the ID token) using the encrypted blob.
 * Internal function - users should call getAccessToken() or getIdentityToken() instead.
 *
 * The encrypted blob itself proves ownership, so no ID token is required.
 * Auth proxy decrypts the blob and uses the refresh token to get a new access token.
 *
 * @param blob - Encrypted JWE blob containing refresh token
 * @returns The stored metadata, with the new tokens
 */
async function refreshTokens(
  blob: string,
  existingMetadata: AuthMetadata
): Promise<AuthMetadata & { access_token: string }> {
  // Call auth proxy to refresh (no ID token needed - blob proves ownership)
  const response = await fetch(`${AUTH_PROXY_URL}/session/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    if (response.status === 401 && error.error === 'invalid_grant') throw new SignInExpiredError()
    throw new Error(error.error || 'Failed to refresh access token')
  }

  const { access_token, expires_in, id_token } = await response.json()

  const updatedMetadata: AuthMetadata & { access_token: string } = {
    ...existingMetadata,
    access_token,
    expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
  }
  if (id_token) updatedMetadata.id_token = id_token

  // Update stored metadata in Service Worker
  await sendToServiceWorker('STORE_BLOB', {
    blob,
    metadata: updatedMetadata,
  })

  return updatedMetadata
}

async function buildStoredUserProfile(user: StoredUser): Promise<StoredUser> {
  // (only for a user with a picture)
  const picture = user.picture as string

  try {
    const response = await fetch(picture, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'force-cache',
    })

    if (!response.ok) {
      throw new Error(`Avatar request failed with status ${response.status}`)
    }

    const blob = await response.blob()
    const avatarDataUrl = await blobToDataUrl(blob)

    return {
      ...user,
      avatarDataUrl,
      avatarUpdatedAt: new Date().toISOString(),
    }
  } catch (error) {
    console.warn(
      '[Auth] Unable to cache avatar image:',
      error instanceof Error ? error.message : error
    )
    return user
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read avatar blob'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

function formatUserInfoForUI(user: StoredUser): UserInfo {
  return {
    name: user.name || null,
    email: user.email || null,
    picture: user.picture || null,
    avatarDataUrl: user.avatarDataUrl || null,
    givenName: user.given_name || null,
    familyName: user.family_name || null,
  }
}

/**
 * Get stored blob from Service Worker
 */
export async function getStoredBlob(): Promise<StoredBlob | undefined> {
  const response = await sendToServiceWorker('GET_BLOB')
  return response.data
}

/**
 * Logout: forget the sign-in on this device (the blob in the service worker), then ask the
 * auth proxy to revoke it at Google. That needs the network: offline, or if Google does not
 * answer, the device is still signed out and the result says the access was not revoked.
 * @returns whether Google revoked the access
 */
export async function logout(): Promise<{ revoked: boolean }> {
  const stored = await getStoredBlob()
  const response = await sendToServiceWorker('DELETE_BLOB')
  if (!response.success) throw new Error(response.error || 'Failed to delete the sign-in')
  if (!stored?.blob) return { revoked: false }

  try {
    const revoked = await fetch(`${AUTH_PROXY_URL}/session/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blob: stored.blob }),
      signal: AbortSignal.timeout(10_000),
    })
    return { revoked: revoked.ok }
  } catch (error) {
    console.warn('[GoogleAuth] Could not revoke the access at Google:', error)
    return { revoked: false }
  }
}

/**
 * Export blob as backup for user to save
 */
export async function exportBlobBackup(): Promise<BlobBackup> {
  const response = await sendToServiceWorker('EXPORT_BLOB')
  if (!response.success || !response.backup) {
    throw new Error(response.error || 'Failed to export blob')
  }
  return response.backup
}

/**
 * Import blob from backup
 */
export async function importBlobBackup(backup: Partial<BlobBackup>): Promise<void> {
  await sendToServiceWorker('IMPORT_BLOB', { backup })
}

/**
 * Download blob backup as JSON file
 */
export async function downloadBlobBackup(): Promise<void> {
  const backup = await exportBlobBackup()

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `chordless-auth-backup-${new Date().toISOString().split('T')[0]}.json`
  a.click()

  URL.revokeObjectURL(url)
}

/**
 * The service worker holds the sign-in, and does not control the page until a later load on
 * the very first visit (or after a hard reload): then there is nothing to ask, which is
 * expected and not an error.
 */
class NoServiceWorkerControllerError extends Error {
  constructor() {
    super('No service worker controller')
    this.name = 'NoServiceWorkerControllerError'
  }
}

function logAuthFailure(what: string, error: unknown): void {
  if (error instanceof NoServiceWorkerControllerError) {
    console.info(`[Auth] ${what}: the service worker is not controlling this page yet`)
  } else {
    console.error(`[Auth] ${what}:`, error)
  }
}

/**
 * Send message to Service Worker and wait for response
 */
async function sendToServiceWorker(
  type: WorkerMessageType,
  data: Record<string, unknown> = {}
): Promise<WorkerReply> {
  const controller = navigator.serviceWorker.controller
  if (!controller) {
    throw new NoServiceWorkerControllerError()
  }

  return new Promise<WorkerReply>((resolve, reject) => {
    const messageChannel = new MessageChannel()
    const messageId = crypto.randomUUID()
    const timeout = setTimeout(() => {
      reject(new Error('Service Worker timeout'))
    }, 10000)

    messageChannel.port1.onmessage = (event: MessageEvent<WorkerReply>) => {
      clearTimeout(timeout)
      if (event.data.messageId === messageId) {
        resolve(event.data)
      }
    }

    controller.postMessage({ type, data, messageId }, [messageChannel.port2])
  })
}
