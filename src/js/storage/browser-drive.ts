/**
 * Drive as the browser's storage backend: the signed-in user's access token (drive-api.ts).
 */
import { driveApi } from '../drive-api.ts'
import { createDriveStorage } from './drive-storage.ts'
import type { StorageBackend } from './types.ts'

export const driveStorage: StorageBackend = createDriveStorage(driveApi)
