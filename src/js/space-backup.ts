/**
 * Make the export of a space and hand it to the browser as a download (docs/SPACES.md, "Export and
 * import"): the export panel's button, and the backup deleting a space everywhere insists on first.
 */
import type { Space } from './data-types.ts'
import { withSource } from './other-songs.ts'
import { createExport, type ExportPadSet, exportFileName } from './space-export.ts'

/** What was handed over: the file's name and its size */
export interface BackupFile {
  fileName: string
  bytes: number
}

/**
 * Export the space as it is on this device (its songs and setlists, and the given pad sets) and
 * start the download. The browser is handed the file; it cannot be known that it was saved.
 */
export async function downloadBackup(
  space: Pick<Space, 'id' | 'name'>,
  pads: ExportPadSet[] = []
): Promise<BackupFile> {
  const blob = await withSource(space.id, db => createExport(db, space.name, pads))
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = exportFileName(space.name)
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
  return { fileName: link.download, bytes: blob.size }
}
