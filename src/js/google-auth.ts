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

import type {
  AuthMetadata,
  BlobBackup,
  QueuedOperation,
  StoredBlob,
  StoredUser,
} from './auth-db.ts'

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
  operations?: QueuedOperation[]
  operationId?: number
}

type WorkerMessageType =
  | 'STORE_BLOB'
  | 'GET_BLOB'
  | 'DELETE_BLOB'
  | 'EXPORT_BLOB'
  | 'IMPORT_BLOB'
  | 'QUEUE_INVITE'
  | 'QUEUE_REVOKE'
  | 'GET_PENDING_OPERATIONS'
  | 'PROCESS_QUEUE'

// Configuration
const GOOGLE_CLIENT_ID = '376758830135-jnbcm135rqisd69g54tgjvmfhrlkmolb.apps.googleusercontent.com'
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.file openid email profile'

// The worker serves the auth routes (/oauth/*, /session/*) on the same origin as
// the app: wrangler dev locally, Tailscale serve/funnel, and production.
const AUTH_PROXY_URL = ''

/**
 * Parse JWT and extract payload
 */
function parseJwt(token: string): Record<string, string> | null {
  try {
    const base64Url = token.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => {
          return `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`
        })
        .join('')
    )
    return JSON.parse(jsonPayload)
  } catch (error) {
    console.error('[Auth] Failed to parse JWT:', error)
    return null
  }
}

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
      const payload = parseJwt(metadata.id_token)
      if (payload) {
        user = {
          name: payload.name || null,
          email: payload.email || null,
          picture: payload.picture || null,
          given_name: payload.given_name || null,
          family_name: payload.family_name || null,
          sub: payload.sub || null,
        }
        shouldPersist = true
      }
    }

    if (!user) {
      return null
    }

    if (!user.avatarDataUrl && user.picture) {
      try {
        const enriched = await buildStoredUserProfile(user)
        if (enriched.avatarDataUrl) {
          user = enriched
          shouldPersist = true
        }
      } catch (error) {
        console.warn('[Auth] Failed to cache avatar image:', error)
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

/**
 * Start OAuth flow to get auth code and exchange for token blob
 */
export async function authorizeWithGoogle(): Promise<AuthorizeResult> {
  await initGoogleAuth()

  return new Promise<AuthorizeResult>((resolve, reject) => {
    // access_type and prompt are not in Google's typed config, but are sent as they always were
    const config: google.accounts.oauth2.CodeClientConfig & {
      access_type: 'offline'
      prompt: 'consent'
    } = {
      client_id: GOOGLE_CLIENT_ID,
      scope: `${GOOGLE_SCOPES} openid email profile`,
      ux_mode: 'popup',
      access_type: 'offline',
      // Force the consent screen every time so Drive scope is always explicitly granted.
      // Without this, Google reuses cached consent and may issue a token without Drive scope.
      prompt: 'consent',
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

          const { blob, access_token, expires_in, id_token, user } = await blobResponse.json()

          const normalizedUser = user ? await buildStoredUserProfile(user).catch(() => user) : null

          const metadata: AuthMetadata = {
            access_token,
            expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
            user: normalizedUser,
          }

          if (id_token) {
            metadata.id_token = id_token
          }

          // Store blob in Service Worker
          await sendToServiceWorker('STORE_BLOB', {
            blob,
            metadata,
          })

          // A new sign-in may be a different account, with different access to the folder
          import('./organisation-access.ts').then(({ refreshOrganisationAccess }) =>
            refreshOrganisationAccess()
          )

          resolve({ blob, access_token, expires_in, user: normalizedUser || user })
        } catch (error) {
          reject(error)
        }
      },
    }
    const client = google.accounts.oauth2.initCodeClient(config)

    client.requestCode()
  })
}

/**
 * Get current ID token (for API calls to auth proxy)
 *
 * NOTE: Used by Drive collaboration operations (invite/revoke via auth proxy).
 *
 * NOTE: Consider refactoring this function if FedCM browser warnings become an issue.
 * The current implementation uses google.accounts.id.prompt() which triggers
 * FedCM and may cause browser warnings. Alternative approaches:
 * - Store ID token from initial OAuth flow and check expiration
 * - Use silent token refresh via iframe
 * - Trigger new OAuth code flow for fresh ID token (requires user interaction)
 */
export async function getIdToken(): Promise<string> {
  await initGoogleAuth()

  return new Promise<string>((resolve, reject) => {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: response => {
        if (response.credential) {
          resolve(response.credential)
        } else {
          reject(new Error('No ID token received'))
        }
      },
    })

    // Prompt for ID token
    google.accounts.id.prompt(notification => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        console.warn('[Auth] ID token prompt not shown, may need re-auth')
        reject(new Error('ID token not available'))
      }
    })
  })
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

  // Add 5 minute buffer before expiry
  const bufferMs = 5 * 60 * 1000

  if (expiresAt.getTime() - now.getTime() > bufferMs) {
    // Token still valid
    return metadata.access_token ?? ''
  }

  // Token expired or about to expire, refresh it
  console.log('[Auth] Access token expired, refreshing...')
  const newToken = await refreshAccessToken(blob, metadata)
  return newToken
}

/**
 * Refresh access token using the encrypted blob.
 * Internal function - users should call getAccessToken() instead.
 *
 * The encrypted blob itself proves ownership, so no ID token is required.
 * Auth proxy decrypts the blob and uses the refresh token to get a new access token.
 *
 * @param blob - Encrypted JWE blob containing refresh token
 * @returns New access token
 */
async function refreshAccessToken(
  blob: string,
  existingMetadata: AuthMetadata = {}
): Promise<string> {
  // Call auth proxy to refresh (no ID token needed - blob proves ownership)
  const response = await fetch(`${AUTH_PROXY_URL}/session/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to refresh access token')
  }

  const { access_token, expires_in } = await response.json()

  const updatedMetadata = {
    ...existingMetadata,
    access_token,
    expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
  }

  // Update stored metadata in Service Worker
  await sendToServiceWorker('STORE_BLOB', {
    blob,
    metadata: updatedMetadata,
  })

  return access_token
}

async function buildStoredUserProfile(user: StoredUser): Promise<StoredUser> {
  if (!user?.picture) {
    return user
  }

  const picture = user.picture

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

function formatUserInfoForUI(user: StoredUser | null): UserInfo | null {
  if (!user) return null

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
 * Logout - delete blob from SW
 */
export async function logout(): Promise<void> {
  await sendToServiceWorker('DELETE_BLOB')
}

/**
 * Export blob as backup for user to save
 */
export async function exportBlobBackup(): Promise<BlobBackup> {
  const response = await sendToServiceWorker('EXPORT_BLOB')
  if (!response.success) {
    throw new Error(response.error || 'Failed to export blob')
  }
  if (!response.backup) throw new Error('Failed to export blob')
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

// ==============================================================================
// FUTURE FEATURE: Drive API Operation Queue
// ==============================================================================
// The functions below are infrastructure for future Google Drive collaboration
// features (invite users, revoke permissions). They queue operations in the
// Service Worker and process them when online and authenticated.
//
// Currently not used by any UI features.
// ==============================================================================

/**
 * Queue an invite operation to grant a user read access to a Drive file
 */
export async function queueInvite(fileId: string, email: string): Promise<WorkerReply> {
  return await sendToServiceWorker('QUEUE_INVITE', { file_id: fileId, email })
}

/**
 * Queue a revoke operation to remove a user's access to a Drive file
 */
export async function queueRevoke(fileId: string, permissionId: string): Promise<WorkerReply> {
  return await sendToServiceWorker('QUEUE_REVOKE', {
    file_id: fileId,
    permission_id: permissionId,
  })
}

/**
 * Get list of pending operations in the queue
 */
export async function getPendingOperations(): Promise<QueuedOperation[]> {
  const response = await sendToServiceWorker('GET_PENDING_OPERATIONS')
  return response.operations || []
}

/**
 * Manually trigger processing of queued operations
 */
export async function processQueue(): Promise<void> {
  await sendToServiceWorker('PROCESS_QUEUE')
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

/**
 * Listen for ID token requests from Service Worker
 *
 * NOTE: This is infrastructure for future Drive API operations.
 * The Service Worker requests ID tokens when processing queued invite/revoke operations.
 * Currently called in app initialization but not actively used until Drive features are implemented.
 */
export function listenForIdTokenRequests(): void {
  navigator.serviceWorker.addEventListener('message', async event => {
    if (event.data.type === 'REQUEST_ID_TOKEN') {
      try {
        const idToken = await getIdToken()
        event.ports[0].postMessage({ idToken })
      } catch (error) {
        console.error('[Auth] Failed to get ID token:', error)
        event.ports[0].postMessage({ idToken: null })
      }
    }
  })
}
