/**
 * Pad sets kept in a space's folder in the fake Drive (tests/fake-drive.ts), through the app's own
 * Google Drive storage: for the tests that look at what is in Drive.
 */
import type { PadSource } from '../src/js/pad-set-service.ts'
import { driveStorage } from '../src/js/storage/browser-drive.ts'

/** The folder of the space the pads are kept in */
export const DRIVE_PADS_ROOT = 'drive-pads-root'

/** The space whose folder it is */
export const DRIVE_PADS_SPACE = 'drive-pads-space'

/** One personal space, whose pads are in `DRIVE_PADS_ROOT` (give it to `setPadSources`) */
export function padSourcesInFakeDrive(spaceId = DRIVE_PADS_SPACE): PadSource[] {
  return [{ spaceId, name: 'Personal', team: false, storage: driveStorage.padsIn(DRIVE_PADS_ROOT) }]
}
