/**
 * Putting away what a live test made in the test account's Drive, from Node and not from the browser:
 * a test that times out closes its pages, and what it made must still go. The share's public link is
 * ended first (a file in the bin can still be read by anyone who has the link), then the folder.
 */
import { createDriveApi } from '../../src/js/drive-client.ts'
import { createDriveStorage } from '../../src/js/storage/drive-storage.ts'
import { accessTokens, credentialsFromEnv } from '../drive/node-side.ts'

/** Put away the space of this name: its shares are ended, and its folder goes to Drive's bin (kept for 30 days) */
export async function cleanUpDrive(spaceName: string): Promise<void> {
  const found = credentialsFromEnv(process.env)
  if ('missing' in found) return
  const api = createDriveApi({
    getAccessToken: accessTokens(found.credentials, { cachePath: '.drive-test/token.json' }),
  })
  const storage = createDriveStorage(api)
  const root = await storage.findRootByName(spaceName)
  if (!root) return
  const space = storage.space(root.ref)
  for (const share of await space.list('shares').catch(() => [])) {
    await space.unpublish(share.ref).catch(error => console.warn('Could not end a share:', error))
  }
  await api.trashFile(root.ref)
}
