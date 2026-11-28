import { expect } from '@open-wc/testing'
import { createDriveApi } from '../../src/js/drive-client.ts'
import { createDriveStorage } from '../../src/js/storage/drive-storage.ts'
import { driveToken } from './commands.ts'

const { describe, it } = window

/** The credentials work */
describe('the real-Drive suite: smoke', () => {
  it('has access to Drive', async () => {
    const storage = createDriveStorage(createDriveApi({ getAccessToken: driveToken }))
    expect(await storage.available()).to.equal(true)
  })
})
