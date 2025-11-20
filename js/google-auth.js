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

// Configuration
const GOOGLE_CLIENT_ID = '376758830135-jnbcm135rqisd69g54tgjvmfhrlkmolb.apps.googleusercontent.com'
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.file openid email profile'

const AUTH_PROXY_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8787'
    : 'https://setalight-auth-proxy.YOUR-SUBDOMAIN.workers.dev'

/**
 * Parse JWT and extract payload
 */
function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
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
export async function getCurrentUserInfo() {
  try {
    const blobData = await getStoredBlob()
    const metadata = blobData?.metadata

    if (!metadata) {
      return null
    }

    let user = metadata.user || null
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
    console.error('[Auth] Failed to get user info:', error)
    return null
  }
}

/**
 * Initialize Google Identity Services
 * Call this once on page load
 */
export function initGoogleAuth() {
  return new Promise(resolve => {
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
    document.head.appendChild(script)
  })
}

/**
 * Start OAuth flow to get auth code and exchange for token blob
 */
export async function authorizeWithGoogle() {
  await initGoogleAuth()

  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPES + ' openid email profile',
      ux_mode: 'popup',
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
            body: JSON.stringify({ code: response.code }),
          })

          if (!blobResponse.ok) {
            const error = await blobResponse.json()
            throw new Error(error.error || 'Failed to exchange code for tokens')
          }

          const { blob, access_token, expires_in, id_token, user } = await blobResponse.json()

          const normalizedUser = user ? await buildStoredUserProfile(user).catch(() => user) : null

          const metadata = {
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

          resolve({ blob, access_token, expires_in, user: normalizedUser || user })
        } catch (error) {
          reject(error)
        }
      },
    })

    client.requestCode()
  })
}

/**
 * Get current ID token (for API calls to auth proxy)
 *
 * NOTE: This is infrastructure for future Drive API operations (invite/revoke).
 * Currently not used by any UI features.
 *
 * TODO: When implementing Drive API features, consider refactoring this function.
 * The current implementation uses google.accounts.id.prompt() which triggers
 * FedCM and may cause browser warnings. Alternative approaches:
 * - Store ID token from initial OAuth flow and check expiration
 * - Use silent token refresh via iframe
 * - Trigger new OAuth code flow for fresh ID token (requires user interaction)
 */
export async function getIdToken() {
  await initGoogleAuth()

  return new Promise((resolve, reject) => {
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
export async function isAuthenticated() {
  try {
    const response = await sendToServiceWorker('GET_BLOB')
    return response.success && response.data != null
  } catch (error) {
    console.error('[Auth] Error checking auth status:', error)
    return false
  }
}

/**
 * Get a valid access token for calling Google Drive API directly.
 * Automatically refreshes if expired.
 *
 * @returns {Promise<string>} Valid access token
 * @throws {Error} If not authenticated or refresh fails
 */
export async function getAccessToken() {
  const response = await sendToServiceWorker('GET_BLOB')

  if (!response.success || !response.data) {
    throw new Error('Not authenticated - please authorize first')
  }

  const { blob, metadata } = response.data
  const expiresAt = new Date(metadata.expires_at)
  const now = new Date()

  // Add 5 minute buffer before expiry
  const bufferMs = 5 * 60 * 1000

  if (expiresAt.getTime() - now.getTime() > bufferMs) {
    // Token still valid
    return metadata.access_token
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
 * @param {string} blob - Encrypted JWE blob containing refresh token
 * @returns {Promise<string>} New access token
 */
async function refreshAccessToken(blob, existingMetadata = {}) {
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

async function buildStoredUserProfile(user) {
  if (!user || !user.picture) {
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
    console.warn('[Auth] Unable to cache avatar image:', error.message)
    return user
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read avatar blob'))
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(blob)
  })
}

function formatUserInfoForUI(user) {
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
export async function getStoredBlob() {
  const response = await sendToServiceWorker('GET_BLOB')
  return response.data
}

/**
 * Logout - delete blob from SW
 */
export async function logout() {
  await sendToServiceWorker('DELETE_BLOB')
}

/**
 * Export blob as backup for user to save
 */
export async function exportBlobBackup() {
  const response = await sendToServiceWorker('EXPORT_BLOB')
  if (!response.success) {
    throw new Error(response.error || 'Failed to export blob')
  }
  return response.backup
}

/**
 * Import blob from backup
 */
export async function importBlobBackup(backup) {
  await sendToServiceWorker('IMPORT_BLOB', { backup })
}

/**
 * Download blob backup as JSON file
 */
export async function downloadBlobBackup() {
  const backup = await exportBlobBackup()

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `setalight-auth-backup-${new Date().toISOString().split('T')[0]}.json`
  a.click()

  URL.revokeObjectURL(url)
}

// ==============================================================================
// Google Drive API Helpers
// ==============================================================================
// The functions below call the Google Drive API directly from the browser.
// They automatically handle token refresh via getAccessToken().
// ==============================================================================

/**
 * Upload a file to Google Drive
 *
 * @param {string} name - File name
 * @param {string} mimeType - MIME type (e.g., 'application/json')
 * @param {string|Blob} content - File content
 * @param {string} [folderId] - Optional parent folder ID
 * @returns {Promise<Object>} File metadata from Drive API
 */
export async function uploadFileToDrive(name, mimeType, content, folderId = null) {
  const accessToken = await getAccessToken()

  const metadata = {
    name,
    mimeType,
  }

  if (folderId) {
    metadata.parents = [folderId]
  }

  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', new Blob([content], { type: mimeType }))

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Drive upload failed: ${error}`)
  }

  return await response.json()
}

/**
 * Download a file from Google Drive
 *
 * @param {string} fileId - Drive file ID
 * @returns {Promise<string>} File content as text
 */
export async function downloadFileFromDrive(fileId) {
  const accessToken = await getAccessToken()

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Drive download failed: ${error}`)
  }

  return await response.text()
}

/**
 * Get file metadata from Google Drive
 *
 * @param {string} fileId - Drive file ID
 * @param {string} [fields] - Optional fields to return (e.g., 'id,name,modifiedTime')
 * @returns {Promise<Object>} File metadata
 */
export async function getFileMetadata(fileId, fields = 'id,name,mimeType,modifiedTime') {
  const accessToken = await getAccessToken()

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=${fields}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to get file metadata: ${error}`)
  }

  return await response.json()
}

/**
 * List files in Google Drive
 *
 * @param {Object} options - Query options
 * @param {string} [options.query] - Search query (e.g., "name contains 'setlist'")
 * @param {string} [options.orderBy] - Order by field (e.g., 'modifiedTime desc')
 * @param {number} [options.pageSize] - Max results per page (default 100)
 * @returns {Promise<Object>} { files: Array, nextPageToken: string }
 */
export async function listDriveFiles(options = {}) {
  const accessToken = await getAccessToken()

  const params = new URLSearchParams({
    pageSize: options.pageSize || 100,
    fields: 'files(id,name,mimeType,modifiedTime),nextPageToken',
  })

  if (options.query) {
    params.append('q', options.query)
  }

  if (options.orderBy) {
    params.append('orderBy', options.orderBy)
  }

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to list files: ${error}`)
  }

  return await response.json()
}

/**
 * Update file content on Google Drive
 *
 * @param {string} fileId - Drive file ID
 * @param {string|Blob} content - New file content
 * @param {string} mimeType - MIME type
 * @returns {Promise<Object>} Updated file metadata
 */
export async function updateDriveFile(fileId, content, mimeType) {
  const accessToken = await getAccessToken()

  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': mimeType,
      },
      body: content,
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Drive update failed: ${error}`)
  }

  return await response.json()
}

/**
 * Delete a file from Google Drive
 *
 * @param {string} fileId - Drive file ID
 * @returns {Promise<void>}
 */
export async function deleteDriveFile(fileId) {
  const accessToken = await getAccessToken()

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok && response.status !== 204) {
    const error = await response.text()
    throw new Error(`Drive delete failed: ${error}`)
  }
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
export async function queueInvite(fileId, email) {
  return await sendToServiceWorker('QUEUE_INVITE', { file_id: fileId, email })
}

/**
 * Queue a revoke operation to remove a user's access to a Drive file
 */
export async function queueRevoke(fileId, permissionId) {
  return await sendToServiceWorker('QUEUE_REVOKE', {
    file_id: fileId,
    permission_id: permissionId,
  })
}

/**
 * Get list of pending operations in the queue
 */
export async function getPendingOperations() {
  const response = await sendToServiceWorker('GET_PENDING_OPERATIONS')
  return response.operations || []
}

/**
 * Manually trigger processing of queued operations
 */
export async function processQueue() {
  await sendToServiceWorker('PROCESS_QUEUE')
}

/**
 * Send message to Service Worker and wait for response
 */
async function sendToServiceWorker(type, data = {}) {
  if (!navigator.serviceWorker.controller) {
    throw new Error('No service worker controller')
  }

  return new Promise((resolve, reject) => {
    const messageChannel = new MessageChannel()
    const messageId = crypto.randomUUID()
    const timeout = setTimeout(() => {
      reject(new Error('Service Worker timeout'))
    }, 10000)

    messageChannel.port1.onmessage = event => {
      clearTimeout(timeout)
      if (event.data.messageId === messageId) {
        resolve(event.data)
      }
    }

    navigator.serviceWorker.controller.postMessage({ type, data, messageId }, [
      messageChannel.port2,
    ])
  })
}

/**
 * Listen for ID token requests from Service Worker
 *
 * NOTE: This is infrastructure for future Drive API operations.
 * The Service Worker requests ID tokens when processing queued invite/revoke operations.
 * Currently called in app initialization but not actively used until Drive features are implemented.
 */
export function listenForIdTokenRequests() {
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
