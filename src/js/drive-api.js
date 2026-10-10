/**
 * Google Drive API Helper
 *
 * Handles all interactions with Google Drive API for Chordless.
 *
 * Folder Structure:
 * - Chordless/ (root)
 *   - [Organisation Name]/
 *     - songs/
 *       - [title-ccli].txt (one chord chart per song variant)
 *     - setlists/
 *       - [date-leader-type-name].json
 *   - pads/
 *
 * Song and setlist file names and appProperties come from drive-metadata.js.
 */

import { APP_VERSION } from './drive-metadata.js'
import * as GoogleAuth from './google-auth.js'

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3'

const ROOT_FOLDER_NAME = 'Chordless'
const PADS_FOLDER_NAME = 'pads'
const PADSET_CATEGORY = 'padset'
const PADSET_FILE_CATEGORY = 'padsetFile'

// Fields returned by uploads and updates. Sync records md5Checksum (computed by
// Drive from the stored content) to detect later remote changes.
const WRITE_FIELDS = 'id,name,mimeType,modifiedTime,md5Checksum'

// Where Drive access tokens come from. Tests replace this to run without the
// service worker auth flow (see tests/fake-drive.js).
let getAccessToken = () => GoogleAuth.getAccessToken()

export function setAccessTokenProvider(provider) {
  getAccessToken = provider || (() => GoogleAuth.getAccessToken())
}

/**
 * Core Drive API operations
 */

/**
 * Make an authenticated request to Google Drive API
 */
export async function driveRequest(endpoint, options = {}) {
  const token = await getAccessToken()

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...options.headers,
  }

  const response = await fetch(`${DRIVE_API_BASE}${endpoint}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }))
    const err = new Error(`Drive API error: ${error.error?.message || response.statusText}`)
    err.status = response.status
    throw err
  }

  // Handle responses with no content (like DELETE operations)
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return null
  }

  return response.json()
}

/**
 * Get a file's metadata, or null if it doesn't exist (404)
 */
export async function getFile(fileId, fields = 'id,name,parents,trashed') {
  try {
    return await driveRequest(`/files/${fileId}?fields=${fields}`)
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

/**
 * People a file or folder is shared with: [{ email, name, role }] for each user
 * permission (role is owner, organizer, fileOrganizer, writer, commenter or
 * reader). Group, domain and "anyone" permissions are skipped.
 */
export async function listFolderPermissions(folderId) {
  const result = await driveRequest(
    `/files/${folderId}/permissions?fields=permissions(id,type,role,emailAddress,displayName,deleted)`
  )
  return (result.permissions || [])
    .filter(p => p.type === 'user' && p.emailAddress && !p.deleted)
    .map(p => ({ email: p.emailAddress, name: p.displayName || p.emailAddress, role: p.role }))
}

/**
 * Rename a file or folder
 */
export async function renameFile(fileId, name) {
  return driveRequest(`/files/${fileId}?fields=id,name`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

/**
 * Batch delete multiple files (up to 100 at a time)
 */
export async function batchDeleteFiles(fileIds) {
  if (fileIds.length === 0) return

  const token = await getAccessToken()
  const boundary = '===============7330845974216740156=='

  // Build batch request body
  let batchBody = ''
  fileIds.forEach((fileId, index) => {
    batchBody += `--${boundary}\r\n`
    batchBody += `Content-Type: application/http\r\n`
    batchBody += `Content-ID: <item${index}>\r\n\r\n`
    batchBody += `DELETE /drive/v3/files/${fileId}\r\n\r\n`
  })
  batchBody += `--${boundary}--`

  const response = await fetch('https://www.googleapis.com/batch/drive/v3', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/mixed; boundary=${boundary}`,
    },
    body: batchBody,
  })

  if (!response.ok) {
    throw new Error(`Batch delete failed: ${response.statusText}`)
  }

  // Parse batch response
  const responseText = await response.text()
  const successCount = (responseText.match(/HTTP\/\d\.\d 2\d\d/g) || []).length

  console.log(`[DriveAPI] Batch deleted ${successCount}/${fileIds.length} files`)
  return successCount
}

/**
 * Concurrent upload of multiple files
 * Note: Google's Batch API doesn't support file content uploads, only metadata operations.
 * So we use high-concurrency individual uploads instead (much faster than sequential).
 *
 * @param {Array} files - Array of { metadata, content, contentType }
 * @returns {Promise<Array>} - One entry per input file, in the same order: the
 *   uploaded file response, or null if that upload failed. Callers pair results
 *   with their inputs by index, so failures must keep their slot.
 */
export async function batchUploadFiles(files) {
  if (files.length === 0) return []

  const CONCURRENT_LIMIT = 30 // Upload 30 files at once
  const results = []

  console.log(
    `[DriveAPI] Uploading ${files.length} files with ${CONCURRENT_LIMIT} concurrent requests...`
  )

  // Process in chunks of CONCURRENT_LIMIT
  for (let i = 0; i < files.length; i += CONCURRENT_LIMIT) {
    const chunk = files.slice(i, i + CONCURRENT_LIMIT)

    // Upload all files in this chunk concurrently
    const uploadPromises = chunk.map(async file => {
      try {
        const token = await getAccessToken()
        const boundary = '-------314159265358979323846'
        const delimiter = `\r\n--${boundary}\r\n`
        const closeDelimiter = `\r\n--${boundary}--`

        const metadataBody = JSON.stringify(file.metadata)
        const body =
          delimiter +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          metadataBody +
          delimiter +
          `Content-Type: ${file.contentType || 'text/plain'}\r\n\r\n` +
          file.content +
          closeDelimiter

        const response = await fetch(
          `${UPLOAD_API_BASE}/files?uploadType=multipart&fields=${WRITE_FIELDS}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: body,
          }
        )

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: { message: response.statusText } }))
          throw new Error(`Upload error: ${error.error?.message || response.statusText}`)
        }

        return await response.json()
      } catch (error) {
        console.error(`[DriveAPI] Failed to upload file:`, error)
        return null // Return null for failed uploads
      }
    })

    // Wait for all uploads in this chunk to complete. Keep nulls (failed uploads)
    // so results stay aligned with files.
    results.push(...(await Promise.all(uploadPromises)))

    console.log(`[DriveAPI] Progress: ${results.length}/${files.length} files processed`)
  }

  const succeeded = results.filter(r => r !== null).length
  console.log(`[DriveAPI] Completed: ${succeeded}/${files.length} files uploaded successfully`)
  return results
}

/**
 * Create a file in Drive: metadata (name, parents, mimeType, appProperties) and
 * content in one multipart request. Returns the file resource (WRITE_FIELDS).
 */
export async function createFile(metadata, content, contentType = 'text/plain') {
  const token = await getAccessToken()
  const boundary = '-------314159265358979323846'
  const encoder = new TextEncoder()

  const headerJson = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
  )
  const metadataBytes = encoder.encode(JSON.stringify(metadata))
  const headerContent = encoder.encode(`\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`)
  const closing = encoder.encode(`\r\n--${boundary}--`)

  let contentBlob
  if (typeof content === 'string') {
    contentBlob = new Blob([encoder.encode(content)])
  } else if (content instanceof Blob) {
    contentBlob = content
  } else if (content instanceof ArrayBuffer) {
    contentBlob = new Blob([content])
  } else if (content instanceof Uint8Array) {
    contentBlob = new Blob([
      content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
    ])
  } else {
    throw new Error('Unsupported content type for Drive upload')
  }

  const body = new Blob([headerJson, metadataBytes, headerContent, contentBlob, closing], {
    type: `multipart/related; boundary=${boundary}`,
  })

  const response = await fetch(
    `${UPLOAD_API_BASE}/files?uploadType=multipart&fields=${WRITE_FIELDS}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }))
    throw new Error(`Drive upload error: ${error.error?.message || response.statusText}`)
  }

  return response.json()
}

/**
 * Update a file's content and metadata (name, appProperties) in one multipart
 * request. appProperties are merged; a null value removes that key. Returns the
 * file resource (WRITE_FIELDS).
 */
export async function updateFile(fileId, metadata, content, contentType = 'text/plain') {
  const token = await getAccessToken()
  const boundary = '-------314159265358979323846'
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n` +
    content +
    `\r\n--${boundary}--`

  const response = await fetch(
    `${UPLOAD_API_BASE}/files/${fileId}?uploadType=multipart&fields=${WRITE_FIELDS}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }))
    throw new Error(`Drive update error: ${error.error?.message || response.statusText}`)
  }

  return response.json()
}

/**
 * Download file content
 */
async function downloadFile(fileId) {
  const token = await getAccessToken()

  const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Drive download error: ${response.statusText}`)
  }

  return response.text()
}

export async function downloadFileBinary(fileId) {
  const token = await getAccessToken()

  const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Drive download error: ${response.statusText}`)
  }

  return response.arrayBuffer()
}

/**
 * Folder Management
 */

/**
 * Find or create the root "Chordless" folder
 */
/**
 * Find the organisation folder with this name under the root Chordless folder,
 * without creating anything. Returns the folder or null.
 */
export async function findOrganisationFolderByName(organisationName) {
  const rootFolderId = await findOrCreateRootFolder()
  const query = `name='${organisationName}' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`
  )
  return result.files?.[0] ?? null
}

export async function findOrCreateRootFolder() {
  console.log('[DriveAPI] Finding/creating root Chordless folder...')

  // Search for existing Chordless folder
  const query = `name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`
  )

  if (result.files && result.files.length > 0) {
    console.log('[DriveAPI] Found existing Chordless folder:', result.files[0].id)
    return result.files[0].id
  }

  // Create new root folder
  console.log('[DriveAPI] Creating new Chordless folder...')
  const folder = await driveRequest('/files', {
    method: 'POST',
    body: JSON.stringify({
      name: ROOT_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Chordless - Worship Setlist Management',
    }),
  })

  console.log('[DriveAPI] Created Chordless folder:', folder.id)
  return folder.id
}

/**
 * Find or create an organisation folder under Chordless/
 */
export async function findOrCreateOrganisationFolder(organisationName, organisationId) {
  console.log(`[DriveAPI] Finding/creating organisation folder: ${organisationName}`)

  const rootFolderId = await findOrCreateRootFolder()

  // Search for existing organisation folder by name and parent
  const query = `name='${organisationName}' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties)`
  )

  if (result.files && result.files.length > 0) {
    console.log('[DriveAPI] Found existing organisation folder:', result.files[0].id)
    return {
      folderId: result.files[0].id,
      isNew: false,
    }
  }

  // Create new organisation folder with appProperties
  console.log('[DriveAPI] Creating new organisation folder...')
  const folder = await driveRequest('/files', {
    method: 'POST',
    body: JSON.stringify({
      name: organisationName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootFolderId],
      appProperties: {
        resourceType: 'organisation',
        organisationId: organisationId,
        createdAt: new Date().toISOString(),
        appVersion: APP_VERSION,
      },
    }),
  })

  console.log('[DriveAPI] Created organisation folder:', folder.id)

  // Create songs and setlists subfolders
  await createSubfolder(folder.id, 'songs')
  await createSubfolder(folder.id, 'setlists')

  return {
    folderId: folder.id,
    isNew: true,
  }
}

export async function getPadsRootFolder() {
  const rootFolderId = await findOrCreateRootFolder()
  let padsFolderId = await findSubfolder(rootFolderId, PADS_FOLDER_NAME)
  if (!padsFolderId) {
    padsFolderId = await createSubfolder(rootFolderId, PADS_FOLDER_NAME)
  }
  return padsFolderId
}

export async function listPadSetFolders() {
  const padsRootId = await getPadsRootFolder()
  const query = `'${padsRootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,modifiedTime)`
  )
  return result.files || []
}

export async function ensurePadSetFolder(padSetName) {
  const padsRootId = await getPadsRootFolder()
  const query = `name='${padSetName}' and '${padsRootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,modifiedTime)`
  )

  if (result.files && result.files.length > 0) {
    const folder = result.files[0]
    await updatePadSetFolderMetadata(folder.id, padSetName)
    return folder.id
  }

  const folder = await driveRequest('/files', {
    method: 'POST',
    body: JSON.stringify({
      name: padSetName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [padsRootId],
      appProperties: {
        category: PADSET_CATEGORY,
        padSetName,
        appVersion: APP_VERSION,
        createdAt: new Date().toISOString(),
      },
    }),
  })

  return folder.id
}

export async function updatePadSetFolderMetadata(folderId, padSetName) {
  return driveRequest(`/files/${folderId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: padSetName,
      appProperties: {
        category: PADSET_CATEGORY,
        padSetName,
        appVersion: APP_VERSION,
        updatedAt: new Date().toISOString(),
      },
    }),
  })
}

export async function listPadSetFiles(folderId) {
  const query = `'${folderId}' in parents and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,modifiedTime,md5Checksum,mimeType)`
  )
  return result.files || []
}

export async function deleteFilesInFolder(folderId) {
  const files = await listPadSetFiles(folderId)
  const fileIds = files.map(file => file.id)
  if (fileIds.length > 0) {
    await batchDeleteFiles(fileIds)
  }
}

export async function uploadPadFile(folderId, key, blob) {
  const metadata = {
    name: `${key}.mp3`,
    parents: [folderId],
    appProperties: {
      category: PADSET_FILE_CATEGORY,
      padKey: key,
      padSetFolderId: folderId,
      appVersion: APP_VERSION,
      uploadedAt: new Date().toISOString(),
    },
  }

  return createFile(metadata, blob, 'audio/mpeg')
}

/**
 * Create a subfolder
 */
async function createSubfolder(parentId, name) {
  console.log(`[DriveAPI] Creating subfolder: ${name}`)

  const folder = await driveRequest('/files', {
    method: 'POST',
    body: JSON.stringify({
      name: name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  })

  return folder.id
}

/**
 * Find subfolder by name within a parent
 */
async function findSubfolder(parentId, name) {
  const query = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`
  )

  if (result.files && result.files.length > 0) {
    return result.files[0].id
  }

  return null
}

/**
 * Get or create songs folder within organisation
 */
export async function getSongsFolder(orgFolderId) {
  let folderId = await findSubfolder(orgFolderId, 'songs')
  if (!folderId) {
    folderId = await createSubfolder(orgFolderId, 'songs')
  }
  return folderId
}

/**
 * Get or create setlists folder within organisation
 */
export async function getSetlistsFolder(orgFolderId) {
  let folderId = await findSubfolder(orgFolderId, 'setlists')
  if (!folderId) {
    folderId = await createSubfolder(orgFolderId, 'setlists')
  }
  return folderId
}

/**
 * Song and setlist files. Their metadata comes from drive-metadata.js; sync
 * creates and updates them with createFile/updateFile.
 */

/**
 * Download a chordpro file from Drive
 */
export async function downloadChordProFile(fileId) {
  console.log(`[DriveAPI] Downloading chordpro: ${fileId}`)
  return downloadFile(fileId)
}

/**
 * Download a setlist from Drive
 */
export async function downloadSetlist(fileId) {
  console.log(`[DriveAPI] Downloading setlist: ${fileId}`)
  const content = await downloadFile(fileId)
  return JSON.parse(content)
}

/**
 * List all setlists in organisation folder
 */
export async function listSetlists(organisationFolderId) {
  const setlistsFolderId = await getSetlistsFolder(organisationFolderId)

  const query = `'${setlistsFolderId}' in parents and trashed=false and name contains '.json'`
  const files = []
  let pageToken = null

  // Drive returns at most one page (default 100) per request, so follow nextPageToken
  do {
    let url =
      `/files?q=${encodeURIComponent(query)}&spaces=drive` +
      '&fields=nextPageToken,files(id,name,appProperties,modifiedTime,md5Checksum)' +
      '&orderBy=modifiedTime desc&pageSize=1000'
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`

    const result = await driveRequest(url)
    files.push(...(result.files || []))
    pageToken = result.nextPageToken || null
  } while (pageToken)

  return files
}

/**
 * Discovery Operations
 */

/**
 * List all Chordless organisation folders
 */
export async function listOrganisations() {
  console.log('[DriveAPI] Listing all Chordless organisations...')

  const rootFolderId = await findOrCreateRootFolder()

  // Find all folders in Chordless root with type=organisation
  const query = `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,createdTime)`
  )

  // Filter to only Chordless organisation folders
  const organisations = (result.files || []).filter(
    folder => folder.appProperties?.type === 'organisation'
  )

  console.log(`[DriveAPI] Found ${organisations.length} organisations`)
  return organisations
}

/**
 * Helper function to check if user is authenticated and has Drive access
 */
export async function checkDriveAccess() {
  try {
    await getAccessToken()
    // Try a simple API call to verify access
    await driveRequest('/about?fields=user')
    return true
  } catch (error) {
    console.warn('[DriveAPI] No Drive access:', error.message)
    return false
  }
}
