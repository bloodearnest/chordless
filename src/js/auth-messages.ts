/**
 * The sign-in's messages: storing, reading, forgetting, exporting and importing the encrypted
 * token blob (and what is kept with it), answered from the auth database (auth-db.ts).
 *
 * The service worker answers them for the pages it controls, so that every page and the worker
 * itself go through one place. A page it does not control (the first visit, before it has taken
 * over, or a hard reload, which bypasses it) answers them itself from the same database
 * (google-auth.ts), so the person is signed in all the same.
 */
import {
  type AuthMetadata,
  type BlobBackup,
  deleteBlob,
  exportBlobBackup,
  getBlob,
  importBlobBackup,
  type StoredBlob,
  storeBlob,
} from './auth-db.ts'

export const AUTH_MESSAGES = [
  'STORE_BLOB',
  'GET_BLOB',
  'DELETE_BLOB',
  'EXPORT_BLOB',
  'IMPORT_BLOB',
] as const

export type AuthMessageType = (typeof AUTH_MESSAGES)[number]

/** What a message sends with it (which of these depends on its type) */
export interface AuthMessageData {
  blob?: string
  metadata?: AuthMetadata
  backup?: Partial<BlobBackup>
}

/** The answer to one */
export interface AuthReply {
  success: boolean
  error?: string
  data?: StoredBlob
  backup?: BlobBackup
}

export function isAuthMessage(type: unknown): type is AuthMessageType {
  return AUTH_MESSAGES.some(each => each === type)
}

/** Answer a sign-in message from the auth database; throws what the database throws */
export async function answerAuthMessage(
  type: AuthMessageType,
  data: AuthMessageData
): Promise<AuthReply> {
  switch (type) {
    case 'STORE_BLOB':
      if (typeof data.blob !== 'string') throw new Error('No blob to store')
      await storeBlob(data.blob, data.metadata)
      return { success: true }
    case 'GET_BLOB':
      return { success: true, data: await getBlob() }
    case 'DELETE_BLOB':
      await deleteBlob()
      return { success: true }
    case 'EXPORT_BLOB':
      return { success: true, backup: await exportBlobBackup() }
    case 'IMPORT_BLOB':
      await importBlobBackup(data.backup as BlobBackup)
      return { success: true }
  }
}
