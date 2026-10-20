import { driveStorage } from '../src/js/storage/drive-storage.ts'
import { type FakeDrive, installFakeDrive } from './fake-drive.ts'
import { describeStorage } from './storage-conformance.ts'

const { afterEach } = window

let drive: ReturnType<typeof installFakeDrive> | undefined
afterEach(() => drive?.uninstall())

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
