/**
 * Ending a setlist's old Drive share link (docs/SHARING.md). Links are made by the Worker now (server-share.ts); one made
 * before a space moved to Chordless is still a file in Drive, copied and stopped as it was until its files are deleted.
 */
import type { SetlistShare } from './data-types.ts'
import { trashFile, unpublishFile } from './drive-api.ts'

/** Stop sharing: end access, then trash the file. The caller clears the setlist's share. */
export async function stopShare(share: Pick<SetlistShare, 'fileId'>): Promise<void> {
  // The public link goes first: a file in the bin can still be read by anyone who has the link
  await unpublishFile(share.fileId)
  await trashFile(share.fileId)
}
