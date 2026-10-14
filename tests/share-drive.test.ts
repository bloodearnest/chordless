import { expect } from '@open-wc/testing'
import {
  createShareFile,
  endShareFile,
  getSharesFolder,
  listShareFiles,
  updateShareFile,
} from '../src/js/drive-api.ts'
import { forUpdate, shareFileMetadata } from '../src/js/drive-metadata.ts'
import { installFakeDrive } from './fake-drive.ts'

const { describe, it, beforeEach, afterEach } = window

const bytes = (...values: number[]) => new Uint8Array(values)
// Every byte value, so anything that treated the file as text would corrupt it
const allBytes = Uint8Array.from({ length: 256 }, (_, i) => i)

describe('Share files in Drive', () => {
  let drive
  let folder: string
  const metadata = shareFileMetadata(
    { id: 'setlist-1' },
    { organisationId: 'org-1', expires: '2026-10-25' }
  )

  beforeEach(async () => {
    drive = installFakeDrive()
    const org = await createOrg()
    folder = await getSharesFolder(org)
  })

  afterEach(() => {
    drive.uninstall()
  })

  async function createOrg() {
    const { driveRequest } = await import('../src/js/drive-api.ts')
    const created = await driveRequest<{ id: string }>('/files', {
      method: 'POST',
      body: JSON.stringify({ name: 'Org', mimeType: 'application/vnd.google-apps.folder' }),
    })
    return created.id
  }

  it('keeps nothing secret in the share file metadata', () => {
    expect(metadata.name).to.equal('setlist-1.share')
    expect(metadata.appProperties).to.deep.equal({
      type: 'share',
      organisationId: 'org-1',
      setlistId: 'setlist-1',
      expires: '2026-10-25',
      appVersion: metadata.appProperties.appVersion,
    })
    const update = forUpdate(metadata, 'share')
    expect(update.appProperties.expires).to.equal('2026-10-25')
    expect(Object.values(update.appProperties)).to.not.include(null)
  })

  it('makes the shares folder once, and only for the shares', async () => {
    expect(await getSharesFolder(drive.findByPath(['Org']).id)).to.equal(folder)
    const folders = [...drive.files.values()].filter((f: any) => f.name === 'shares')
    expect(folders).to.have.length(1)
    expect(folders[0].permissions).to.deep.equal([])
  })

  it('creates a share file readable by anyone, though not discoverable', async () => {
    const file = await createShareFile(folder, metadata, allBytes)
    const stored = drive.files.get(file.id)
    expect(stored.parents).to.deep.equal([folder])
    expect(stored.permissions).to.deep.equal([
      { id: 'anyoneWithLink', type: 'anyone', role: 'reader', allowFileDiscovery: false },
    ])
    expect(drive.anonymousDownload(file.id)).to.deep.equal({ status: 200, bytes: allBytes })
  })

  it('updates in place: same id, new content, link unchanged', async () => {
    const file = await createShareFile(folder, metadata, bytes(1, 2, 3))
    const before = drive.files.get(file.id).md5Checksum
    const updated = await updateShareFile(file.id, forUpdate(metadata, 'share'), bytes(9, 8, 7))
    expect(updated.id).to.equal(file.id)
    expect(drive.files.get(file.id).md5Checksum).to.not.equal(before)
    expect(drive.anonymousDownload(file.id).bytes).to.deep.equal(bytes(9, 8, 7))
    expect(drive.files.get(file.id).permissions).to.have.length(1)
  })

  it('lists live shares with the properties that say when they end', async () => {
    const file = await createShareFile(folder, metadata, bytes(1))
    const other = await createShareFile(
      folder,
      shareFileMetadata({ id: 'setlist-2' }, { organisationId: 'org-1', expires: '2026-11-01' }),
      bytes(2)
    )
    await endShareFile(other.id)
    const files = await listShareFiles(folder)
    expect(files.map(f => f.id)).to.deep.equal([file.id])
    expect(files[0].appProperties?.expires).to.equal('2026-10-25')
  })

  it('ending a share revokes the permission as well as trashing the file', async () => {
    const file = await createShareFile(folder, metadata, bytes(1))
    await endShareFile(file.id)
    const stored = drive.files.get(file.id)
    expect(stored.trashed).to.equal(true)
    expect(drive.anonymousDownload(file.id).status).to.equal(404)
    // Never a permanent delete
    expect(drive.files.has(file.id)).to.equal(true)
  })

  it('trashing alone would leave it public, as real Drive does', async () => {
    const file = await createShareFile(folder, metadata, bytes(1))
    drive.files.get(file.id).trashed = true
    expect(drive.anonymousDownload(file.id).status).to.equal(200)
  })

  it('ending a share that is already gone is fine', async () => {
    const file = await createShareFile(folder, metadata, bytes(1))
    await endShareFile(file.id)
    await endShareFile(file.id)
    drive.files.delete(file.id)
    await endShareFile(file.id)
  })

  it('trashes the file again if it cannot be made public', async () => {
    drive.failRequests({ method: 'POST', path: /permissions/, status: 403 })
    let error: Error | undefined
    try {
      await createShareFile(folder, metadata, bytes(1))
    } catch (e) {
      error = e as Error
    }
    expect(error?.message).to.match(/403/)
    const [leftover] = drive.listFiles(f => f.name === 'setlist-1.share')
    expect(leftover.trashed).to.equal(true)
  })
})
