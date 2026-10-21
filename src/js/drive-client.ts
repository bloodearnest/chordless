/**
 * Google Drive API Helper
 *
 * Handles all interactions with Google Drive API for Chordless.
 *
 * Folder Structure:
 * - Chordless/ (root)
 *   - [Space Name]/
 *     - songs/
 *       - [title-ccli].txt (one chord chart per song variant)
 *     - setlists/
 *       - [date-leader-type-name].json
 *   - pads/
 *
 * Song and setlist file names and appProperties come from drive-metadata.js.
 */

import type {
  DriveContent,
  DriveFile,
  DriveFileList,
  DriveFileWrite,
  SpaceMember,
} from './data-types.ts'
import { APP_VERSION } from './drive-metadata.ts'

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3'

const ROOT_FOLDER_NAME = 'Chordless'
const PADS_FOLDER_NAME = 'pads'
const PADSET_CATEGORY = 'padset'
const PADSET_FILE_CATEGORY = 'padsetFile'

// Fields returned by uploads and updates. Sync records md5Checksum (computed by
// Drive from the stored content) to detect later remote changes.
const WRITE_FIELDS = 'id,name,mimeType,createdTime,modifiedTime,md5Checksum,appProperties'

/**
 * Every call on files (and their permissions) says it may meet files in a shared drive, which
 * Drive otherwise refuses or leaves out; a listing also asks for the shared drives' items.
 * A team space's folder may be on one (docs/SPACES.md). Not for other endpoints, which have no use
 * for them (the probe found /about accepts them, but there is no reason to send them).
 * Without a shared drive involved, nothing changes (checked on a real My Drive, 2026-10-19).
 */
const ALL_DRIVES = 'supportsAllDrives=true'
const ALL_DRIVES_LIST = `${ALL_DRIVES}&includeItemsFromAllDrives=true`

export function allDrivesUrl(endpoint: string, method = 'GET'): string {
  if (!/^\/files(\/|\?|$)/.test(endpoint)) return endpoint
  const isList = method === 'GET' && /^\/files(\?|$)/.test(endpoint)
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}${isList ? ALL_DRIVES_LIST : ALL_DRIVES}`
}

/** A failed Drive request, with the HTTP status */
export interface DriveError extends Error {
  status: number
}

/** What Drive's JSON error responses say */
interface DriveErrorBody {
  error?: { message?: string; errors?: { reason?: string }[] }
}

/** A file to upload with batchUploadFiles */
export interface DriveUpload {
  metadata: DriveFileWrite
  content: string
  contentType?: string
}

/** A permission on a file or folder (the fields we ask for) */
interface DrivePermission {
  id: string
  type: string
  role: string
  emailAddress?: string
  displayName?: string
  deleted?: boolean
}

/** What a Drive client needs from where it runs */
export interface DriveClientOptions {
  /** Where access tokens come from: the browser's sign-in, or a team space's credential */
  getAccessToken: () => Promise<string>
  /** Defaults to the global `fetch`, read at each call so a test can replace it */
  fetch?: typeof fetch
}

/**
 * The Drive operations, for one source of access tokens. The browser's is `drive-api.ts`; the
 * Worker makes one per team space (worker/src/team-drive.ts), so two spaces served at once never
 * share a credential.
 */
export function createDriveApi({
  getAccessToken,
  fetch: doFetch = (input, init) => fetch(input, init),
}: DriveClientOptions) {
  let writeRefusals = 0

  /**
   * How many times Drive has refused a write for lack of permission (not for a rate limit). The
   * push code tries again, and gives up quietly, on a failed write, so sync asks this after a
   * push to find out whether the user can only read the folder.
   */
  const countWriteRefusals = () => writeRefusals

  function noteWriteRefusal(response: Response, body: DriveErrorBody): void {
    if (response.status === 403 && !/rate/i.test(body.error?.errors?.[0]?.reason ?? '')) {
      writeRefusals++
    }
  }

  /**
   * Core Drive API operations
   */

  /**
   * Make an authenticated request to Google Drive API. T is what the endpoint returns as JSON;
   * a response with no content (DELETE) gives null, so only ask for T where there is one.
   */
  async function driveRequest<T = DriveFileList>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await getAccessToken()

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    }

    const response = await doFetch(`${DRIVE_API_BASE}${allDrivesUrl(endpoint, options.method)}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error: DriveErrorBody = await response
        .json()
        .catch(() => ({ error: { message: response.statusText } }))
      if (options.method && options.method !== 'GET') noteWriteRefusal(response, error)
      throw Object.assign(
        new Error(`Drive API error: ${error.error?.message || response.statusText}`),
        {
          status: response.status,
        }
      )
    }

    // Handle responses with no content (like DELETE operations)
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return null as T
    }

    return response.json()
  }

  /**
   * The files a Drive query matches, all pages of it, with the fields sync reads (the storage
   * adapter's listings). `orderBy` is Drive's, e.g. `modifiedTime desc`.
   */
  async function listDriveFiles(query: string, orderBy?: string): Promise<DriveFile[]> {
    const files: DriveFile[] = []
    let pageToken: string | undefined
    do {
      const result: DriveFileList = await driveRequest(
        `/files?q=${encodeURIComponent(query)}&spaces=drive&pageSize=1000` +
          '&fields=nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,md5Checksum,appProperties)' +
          (orderBy ? `&orderBy=${encodeURIComponent(orderBy)}` : '') +
          (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
      )
      files.push(...result.files)
      pageToken = result.nextPageToken
    } while (pageToken)
    return files
  }

  /**
   * Get a file's metadata, or null if it doesn't exist (404)
   */
  async function getFile(
    fileId: string,
    fields = 'id,name,parents,trashed'
  ): Promise<DriveFile | null> {
    try {
      return await driveRequest<DriveFile>(`/files/${fileId}?fields=${fields}`)
    } catch (error) {
      if (error instanceof Error && (error as DriveError).status === 404) return null
      throw error
    }
  }

  /**
   * People a file or folder is shared with: [{ email, name, role }] for each user
   * permission (role is owner, organizer, fileOrganizer, writer, commenter or
   * reader). Group, domain and "anyone" permissions are skipped.
   */
  async function listFolderPermissions(folderId: string): Promise<SpaceMember[]> {
    const result = await driveRequest<{ permissions?: DrivePermission[] }>(
      `/files/${folderId}/permissions?fields=permissions(id,type,role,emailAddress,displayName,deleted)`
    )
    return (result.permissions || [])
      .filter(
        (p): p is DrivePermission & { emailAddress: string } =>
          p.type === 'user' && Boolean(p.emailAddress) && !p.deleted
      )
      .map(p => ({ email: p.emailAddress, name: p.displayName || p.emailAddress, role: p.role }))
  }

  /**
   * Rename a file or folder
   */
  async function renameFile(fileId: string, name: string): Promise<DriveFile> {
    return driveRequest<DriveFile>(`/files/${fileId}?fields=id,name`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
  }

  /**
   * Concurrent upload of multiple files
   * Note: Google's Batch API doesn't support file content uploads, only metadata operations.
   * So we use high-concurrency individual uploads instead (much faster than sequential).
   *
   * @returns One entry per input file, in the same order: the uploaded file response, or null
   *   if that upload failed. Callers pair results with their inputs by index, so failures must
   *   keep their slot.
   */
  async function batchUploadFiles(files: DriveUpload[]): Promise<(DriveFile | null)[]> {
    if (files.length === 0) return []

    const CONCURRENT_LIMIT = 30 // Upload 30 files at once
    const results: (DriveFile | null)[] = []

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

          const response = await doFetch(
            `${UPLOAD_API_BASE}/files?uploadType=multipart&fields=${WRITE_FIELDS}&${ALL_DRIVES}`,
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
            const error: DriveErrorBody = await response
              .json()
              .catch(() => ({ error: { message: response.statusText } }))
            noteWriteRefusal(response, error)
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
    }

    return results
  }

  /**
   * Create a file in Drive: metadata (name, parents, mimeType, appProperties) and
   * content in one multipart request. Returns the file resource (WRITE_FIELDS).
   */
  async function createFile(
    metadata: DriveFileWrite,
    content: DriveContent,
    contentType = 'text/plain'
  ): Promise<DriveFile> {
    const token = await getAccessToken()
    const { body, boundary } = multipartBody(metadata, content, contentType)

    const response = await doFetch(
      `${UPLOAD_API_BASE}/files?uploadType=multipart&fields=${WRITE_FIELDS}&${ALL_DRIVES}`,
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
      const error: DriveErrorBody = await response
        .json()
        .catch(() => ({ error: { message: response.statusText } }))
      noteWriteRefusal(response, error)
      throw Object.assign(
        new Error(`Drive upload error: ${error.error?.message || response.statusText}`),
        { status: response.status }
      )
    }

    return response.json()
  }

  /** A multipart/related upload body: the metadata as JSON, then the content as it is */
  function multipartBody(metadata: DriveFileWrite, content: DriveContent, contentType: string) {
    const boundary = '-------314159265358979323846'
    const encoder = new TextEncoder()

    const headerJson = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
    )
    const metadataBytes = encoder.encode(JSON.stringify(metadata))
    const headerContent = encoder.encode(
      `\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
    )
    const closing = encoder.encode(`\r\n--${boundary}--`)

    let contentBlob: Blob
    if (typeof content === 'string') {
      contentBlob = new Blob([encoder.encode(content)])
    } else if (content instanceof Blob) {
      contentBlob = content
    } else if (content instanceof ArrayBuffer) {
      contentBlob = new Blob([content])
    } else if (content instanceof Uint8Array) {
      contentBlob = new Blob([
        content.buffer.slice(
          content.byteOffset,
          content.byteOffset + content.byteLength
        ) as ArrayBuffer,
      ])
    } else {
      throw new Error('Unsupported content type for Drive upload')
    }

    const body = new Blob([headerJson, metadataBytes, headerContent, contentBlob, closing], {
      type: `multipart/related; boundary=${boundary}`,
    })
    return { body, boundary }
  }

  /**
   * Update a file's content and metadata (name, appProperties) in one multipart
   * request. appProperties are merged; a null value removes that key. Returns the
   * file resource (WRITE_FIELDS).
   */
  async function updateFile(
    fileId: string,
    metadata: DriveFileWrite,
    content: DriveContent,
    contentType = 'text/plain'
  ): Promise<DriveFile> {
    const token = await getAccessToken()
    const { body, boundary } = multipartBody(metadata, content, contentType)

    const response = await doFetch(
      `${UPLOAD_API_BASE}/files/${fileId}?uploadType=multipart&fields=${WRITE_FIELDS}&${ALL_DRIVES}`,
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
      const error: DriveErrorBody = await response
        .json()
        .catch(() => ({ error: { message: response.statusText } }))
      noteWriteRefusal(response, error)
      throw Object.assign(
        new Error(`Drive update error: ${error.error?.message || response.statusText}`),
        { status: response.status }
      )
    }

    return response.json()
  }

  /**
   * Download file content
   */
  async function downloadFile(fileId: string): Promise<string> {
    const token = await getAccessToken()

    const response = await doFetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media&${ALL_DRIVES}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw Object.assign(new Error(`Drive download error: ${response.statusText}`), {
        status: response.status,
      })
    }

    return response.text()
  }

  async function downloadFileBinary(fileId: string): Promise<ArrayBuffer> {
    const token = await getAccessToken()

    const response = await doFetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media&${ALL_DRIVES}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw Object.assign(new Error(`Drive download error: ${response.statusText}`), {
        status: response.status,
      })
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
   * Find the space folder with this name under the root Chordless folder,
   * without creating anything. Returns the folder or null.
   */
  async function findSpaceFolderByName(spaceName: string): Promise<DriveFile | null> {
    const rootFolderId = await findOrCreateRootFolder()
    const query = `name='${spaceName}' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    const result = await driveRequest(
      `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`
    )
    return result.files[0] ?? null
  }

  async function findOrCreateRootFolder(): Promise<string> {
    // Search for existing Chordless folder
    const query = `name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    const result = await driveRequest(
      `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`
    )

    if (result.files.length > 0) {
      return result.files[0].id
    }

    // Create new root folder
    const folder = await driveRequest<DriveFile>('/files', {
      method: 'POST',
      body: JSON.stringify({
        name: ROOT_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
        description: 'Chordless - Worship Setlist Management',
      }),
    })

    return folder.id
  }

  /**
   * Find or create a space folder under Chordless/
   */
  async function findOrCreateSpaceFolder(
    spaceName: string,
    spaceId: string
  ): Promise<{ folderId: string; isNew: boolean }> {
    const rootFolderId = await findOrCreateRootFolder()

    // Search for existing space folder by name and parent
    const query = `name='${spaceName}' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    const result = await driveRequest(
      `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties)`
    )

    if (result.files.length > 0) {
      return {
        folderId: result.files[0].id,
        isNew: false,
      }
    }

    // Create new space folder with appProperties
    const folder = await driveRequest<DriveFile>('/files', {
      method: 'POST',
      body: JSON.stringify({
        name: spaceName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [rootFolderId],
        appProperties: {
          resourceType: 'space',
          spaceId: spaceId,
          createdAt: new Date().toISOString(),
          appVersion: APP_VERSION,
        },
      }),
    })

    // Create songs and setlists subfolders
    await createSubfolder(folder.id, 'songs')
    await createSubfolder(folder.id, 'setlists')

    return {
      folderId: folder.id,
      isNew: true,
    }
  }

  async function getPadsRootFolder(): Promise<string> {
    const rootFolderId = await findOrCreateRootFolder()
    let padsFolderId = await findSubfolder(rootFolderId, PADS_FOLDER_NAME)
    if (!padsFolderId) {
      padsFolderId = await createSubfolder(rootFolderId, PADS_FOLDER_NAME)
    }
    return padsFolderId
  }

  async function listPadSetFolders(): Promise<DriveFile[]> {
    const padsRootId = await getPadsRootFolder()
    const query = `'${padsRootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    const result = await driveRequest(
      `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,modifiedTime)`
    )
    return result.files
  }

  async function ensurePadSetFolder(padSetName: string): Promise<string> {
    const padsRootId = await getPadsRootFolder()
    const query = `name='${padSetName}' and '${padsRootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    const result = await driveRequest(
      `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,modifiedTime)`
    )

    if (result.files.length > 0) {
      const folder = result.files[0]
      await updatePadSetFolderMetadata(folder.id, padSetName)
      return folder.id
    }

    const folder = await driveRequest<DriveFile>('/files', {
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

  async function updatePadSetFolderMetadata(
    folderId: string,
    padSetName: string
  ): Promise<DriveFile> {
    return driveRequest<DriveFile>(`/files/${folderId}`, {
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

  async function listPadSetFiles(folderId: string): Promise<DriveFile[]> {
    const query = `'${folderId}' in parents and trashed=false`
    const result = await driveRequest(
      `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,modifiedTime,md5Checksum,mimeType,size)`
    )
    return result.files
  }

  /**
   * Move the files of a folder to the Drive trash (recoverable, like everything else the app
   * removes). Not a permanent delete: in a shared drive only a Manager may do that, and a Content
   * manager, who may trash, would find it silently did nothing (checked 2026-10-19, docs/SPACES.md).
   */
  async function trashFilesInFolder(folderId: string): Promise<void> {
    const files = await listPadSetFiles(folderId)
    await Promise.all(files.map(file => trashFile(file.id)))
  }

  async function uploadPadFile(folderId: string, key: string, blob: Blob): Promise<DriveFile> {
    const metadata: DriveFileWrite = {
      name: `${key}.mp3`,
      mimeType: 'audio/mpeg',
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
  async function createSubfolder(parentId: string, name: string): Promise<string> {
    const folder = await driveRequest<DriveFile>('/files', {
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
  async function findSubfolder(parentId: string, name: string): Promise<string | null> {
    const query = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    const result = await driveRequest(
      `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`
    )

    if (result.files.length > 0) {
      return result.files[0].id
    }

    return null
  }

  /**
   * Get or create songs folder within space
   */
  async function getSongsFolder(spaceFolderId: string): Promise<string> {
    let folderId = await findSubfolder(spaceFolderId, 'songs')
    if (!folderId) {
      folderId = await createSubfolder(spaceFolderId, 'songs')
    }
    return folderId
  }

  /**
   * Get or create setlists folder within space
   */
  async function getSetlistsFolder(spaceFolderId: string): Promise<string> {
    let folderId = await findSubfolder(spaceFolderId, 'setlists')
    if (!folderId) {
      folderId = await createSubfolder(spaceFolderId, 'setlists')
    }
    return folderId
  }

  /**
   * Share links (docs/SHARING.md). A share is one encrypted file in the space's shares/
   * folder, readable by anyone with its id, though not discoverable. Only that file is public.
   */

  /** The space's shares folder, or null if nothing has ever been shared (nothing is created) */
  function findSharesFolder(spaceFolderId: string): Promise<string | null> {
    return findSubfolder(spaceFolderId, 'shares')
  }

  /** Get or create the shares folder within a space (it stays private) */
  async function getSharesFolder(spaceFolderId: string): Promise<string> {
    let folderId = await findSubfolder(spaceFolderId, 'shares')
    if (!folderId) {
      folderId = await createSubfolder(spaceFolderId, 'shares')
    }
    return folderId
  }

  /**
   * Make a file readable by anyone with its link (not discoverable). If Drive refuses (a Workspace
   * admin may forbid it) the file is trashed again, so no private leftover stays, and the error is
   * thrown.
   */
  async function publishFile(fileId: string): Promise<void> {
    try {
      await driveRequest(`/files/${fileId}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }),
      })
    } catch (error) {
      // Best effort: a private leftover is harmless, and the error that matters is the original
      await trashFile(fileId).catch(e => console.warn('[DriveAPI] Could not trash share file:', e))
      throw refusedPublicLink(error)
    }
  }

  /** Move a file to the Drive trash (recoverable); a file that is already gone is fine. Trashing alone leaves a public file readable. */
  async function trashFile(fileId: string): Promise<void> {
    try {
      await driveRequest(`/files/${fileId}`, {
        method: 'PATCH',
        body: JSON.stringify({ trashed: true }),
      })
    } catch (error) {
      if ((error as Partial<DriveError>).status !== 404) throw error
    }
  }

  /** Take back the public link of a file; a file that is already gone is fine */
  async function unpublishFile(fileId: string): Promise<void> {
    try {
      await driveRequest(`/files/${fileId}/permissions/anyoneWithLink`, { method: 'DELETE' })
    } catch (error) {
      if ((error as Partial<DriveError>).status !== 404) throw error
    }
  }

  /**
   * Drive refused to make the share file readable by anyone with the link. Of everything a share
   * does, only that step can be forbidden by policy (a Workspace admin can turn off sharing outside
   * the domain), so a refusal there, other than a sign-in or a rate limit, is said to be that.
   * Anything else (the network, a server error) is left as it was.
   */
  function refusedPublicLink(error: unknown): unknown {
    const status = (error as DriveError | undefined)?.status
    if (status === undefined || status === 401 || status === 429 || status < 400 || status >= 500) {
      return error
    }
    return Object.assign(
      new Error(
        `Google would not make the link public: your organisation may not allow links that anyone can open. The song list to paste still works. (${(error as Error).message})`
      ),
      { status, cause: error }
    )
  }

  /**
   * Helper function to check if user is authenticated and has Drive access
   */
  async function checkDriveAccess(): Promise<boolean> {
    try {
      await getAccessToken()
      // Try a simple API call to verify access
      await driveRequest('/about?fields=user')
      return true
    } catch (error) {
      console.warn('[DriveAPI] No Drive access:', error instanceof Error ? error.message : error)
      return false
    }
  }

  return {
    countWriteRefusals,
    driveRequest,
    listDriveFiles,
    getFile,
    listFolderPermissions,
    renameFile,
    batchUploadFiles,
    createFile,
    updateFile,
    downloadFile,
    downloadFileBinary,
    findSpaceFolderByName,
    findOrCreateRootFolder,
    findOrCreateSpaceFolder,
    getPadsRootFolder,
    listPadSetFolders,
    ensurePadSetFolder,
    updatePadSetFolderMetadata,
    listPadSetFiles,
    trashFilesInFolder,
    uploadPadFile,
    getSongsFolder,
    getSetlistsFolder,
    findSharesFolder,
    getSharesFolder,
    publishFile,
    trashFile,
    unpublishFile,
    checkDriveAccess,
  }
}

export type DriveApi = ReturnType<typeof createDriveApi>
