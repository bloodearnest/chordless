/**
 * Google Drive API Helper, for the browser: the Drive operations (drive-client.ts) with the
 * signed-in user's access token. The Worker makes its own, with a team space's credential.
 */
import { createDriveApi } from './drive-client.ts'
import * as GoogleAuth from './google-auth.ts'

export { allDrivesUrl } from './drive-client.ts'

// Where Drive access tokens come from. Tests replace this to run without the
// service worker auth flow (see tests/fake-drive.js).
type AccessTokenProvider = () => Promise<string>

let getAccessToken: AccessTokenProvider = () => GoogleAuth.getAccessToken()

export function setAccessTokenProvider(provider?: AccessTokenProvider | null) {
  getAccessToken = provider || (() => GoogleAuth.getAccessToken())
}

/** The operations, read through `getAccessToken` at each call so a replaced provider is used */
export const driveApi = createDriveApi({ getAccessToken: () => getAccessToken() })

export const {
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
} = driveApi
