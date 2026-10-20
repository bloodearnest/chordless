import { expect } from '@open-wc/testing'
import { driveStorage } from '../src/js/storage/drive-storage.ts'
import { type FakeDrive, installFakeDrive } from './fake-drive.ts'
import { describeStorage } from './storage-conformance.ts'

const { afterEach, describe, it } = window

let drive: ReturnType<typeof installFakeDrive> | undefined
afterEach(() => drive?.uninstall())

describe('Google Drive (on FakeDrive): what the interface leaves to it', () => {
  it('does not make a shares folder for a space that never shares', async () => {
    const fake = installFakeDrive()
    drive = fake
    const root = await driveStorage.ensureRoot('Grace Church', 'space-1')
    expect(await driveStorage.space(root.ref).list('shares')).to.deep.equal([])
    expect(fake.findByPath(['Chordless', 'Grace Church', 'shares'])).to.equal(null)
    await driveStorage
      .space(root.ref)
      .create('shares', { name: 'a.share', props: {}, type: 'application/octet-stream' }, 'x')
    expect(fake.findByPath(['Chordless', 'Grace Church', 'shares'])).to.not.equal(null)
  })
})

describeStorage('Google Drive (on FakeDrive)', async () => {
  drive?.uninstall()
  const fake: FakeDrive = installFakeDrive()
  drive = fake as ReturnType<typeof installFakeDrive>
  return {
    backend: driveStorage,
    trash: ref => {
      fake.files.get(ref).trashed = true
    },
    remove: ref => {
      fake.files.delete(ref)
    },
    edit: (ref, content) => fake.editContent(ref, content),
    publicDownload: ref => fake.anonymousDownload(ref),
    pageSize: size => {
      fake.maxPageSize = size
    },
    async fileElsewhere() {
      const other = await driveStorage.ensureRoot('Elsewhere', 'space-elsewhere')
      const { file } = await driveStorage
        .space(other.ref)
        .create('songs', { name: 'there.txt', props: {}, type: 'text/plain' }, 'x')
      return file.ref
    },
  }
})
