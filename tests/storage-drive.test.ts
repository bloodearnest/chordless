import { expect } from '@open-wc/testing'
import { driveStorage } from '../src/js/storage/drive-storage.ts'
import { type FakeDrive, installFakeDrive } from './fake-drive.ts'
import { describeStorage } from './storage-conformance.ts'

const { afterEach, describe, it } = window

let drive: ReturnType<typeof installFakeDrive> | undefined
afterEach(() => drive?.uninstall())

describe('Google Drive (on FakeDrive): what the interface leaves to it', () => {
  it('is available when Drive can be reached with a token, and is not otherwise', async () => {
    const fake = installFakeDrive()
    drive = fake
    expect(await driveStorage.available()).to.equal(true)
    fake.failRequests({ status: 401, times: 5 })
    expect(await driveStorage.available()).to.equal(false)
  })

  const text = { name: 'a.txt', props: {}, type: 'text/plain' }

  it('says whether the person may write to the root, or that it was not told', async () => {
    const fake = installFakeDrive()
    drive = fake
    const { ref } = await driveStorage.ensureRoot('Grace Church', 'space-1')
    expect((await driveStorage.inspectRoot(ref))?.canWrite).to.equal(true)
    fake.readOnly = true
    expect((await driveStorage.inspectRoot(ref))?.canWrite).to.equal(false)
    fake.readOnly = false
    fake.omitCapabilities = true
    expect((await driveStorage.inspectRoot(ref))?.canWrite).to.equal(null)
  })

  it('finds a root by its name, and has no name for a root Drive gave none', async () => {
    const fake = installFakeDrive()
    drive = fake
    const { ref } = await driveStorage.ensureRoot('Grace Church', 'space-1')
    expect((await driveStorage.findRootByName('Grace Church'))?.ref).to.equal(ref)
    fake.files.get(ref).name = undefined
    expect((await driveStorage.inspectRoot(ref))?.name).to.equal('')
    expect(await driveStorage.findRootByName('Grace Church')).to.equal(null)
  })

  it('says a file has no time or properties when Drive gave none', async () => {
    const fake = installFakeDrive()
    drive = fake
    const space = driveStorage.space((await driveStorage.ensureRoot('Grace Church', 's')).ref)
    const { file } = await space.create('songs', text, 'x')
    const stored = fake.files.get(file.ref)
    stored.modifiedTime = undefined
    stored.createdTime = undefined
    stored.name = undefined
    stored.md5Checksum = undefined
    stored.appProperties = undefined
    expect(await space.list('songs')).to.deep.equal([
      { ref: file.ref, name: '', props: {}, rev: null, modified: null, created: null },
    ])
  })

  it('says when Drive stored other content than was sent, for each way of writing', async () => {
    const fake = installFakeDrive()
    drive = fake
    const space = driveStorage.space((await driveStorage.ensureRoot('Grace Church', 's')).ref)
    fake.corruptUploads = 1
    const created = await space.create('songs', text, 'one')
    expect(created.intact).to.equal(false)
    fake.corruptUploads = 1
    expect((await space.update(created.file.ref, text, 'two')).intact).to.equal(false)
    fake.corruptUploads = 1
    const many = await space.createMany('songs', [
      { input: { ...text, name: 'b.txt' }, body: 'three' },
    ])
    expect(many[0]?.intact).to.equal(false)
    expect((await space.update(created.file.ref, text, 'four')).intact).to.equal(true)
  })

  it('makes none, one that failed as nothing, and the others, when creating several', async () => {
    const fake = installFakeDrive()
    drive = fake
    const space = driveStorage.space((await driveStorage.ensureRoot('Grace Church', 's')).ref)
    expect(await space.createMany('songs', [])).to.deep.equal([])
    fake.failRequests({ method: 'POST', path: /^\/upload\//, status: 500 })
    const results = await space.createMany('songs', [
      { input: { ...text, name: 'a.txt' }, body: 'a' },
      { input: { ...text, name: 'b.txt' }, body: 'b' },
    ])
    expect(results.map(r => r?.file.name ?? null)).to.deep.equal([null, 'b.txt'])
  })

  it('does not take back a link, or bin a file, when Drive fails in another way than 404', async () => {
    const fake = installFakeDrive()
    drive = fake
    const space = driveStorage.space((await driveStorage.ensureRoot('Grace Church', 's')).ref)
    const { file } = await space.create(
      'shares',
      { ...text, type: 'application/octet-stream' },
      'x',
      {
        publicLink: true,
      }
    )
    fake.failRequests({ method: 'DELETE', path: /permissions/, status: 500 })
    let error: unknown
    await space.unpublish(file.ref).catch(e => {
      error = e
    })
    expect((error as { status?: number }).status).to.equal(500)
    fake.failRequests({ method: 'PATCH', path: /\/files\//, status: 500 })
    error = undefined
    await space.trash(file.ref).catch(e => {
      error = e
    })
    expect((error as { status?: number }).status).to.equal(500)
  })

  it('names a pad set by its pad set name, else by its folder, else by its id', async () => {
    const fake = installFakeDrive()
    drive = fake
    const ref = await driveStorage.pads.ensureSet('Warm pads')
    const nameOf = async () =>
      (await driveStorage.pads.listSets()).find(set => set.ref === ref)?.name
    expect(await nameOf()).to.equal('Warm pads')
    fake.files.get(ref).appProperties = {}
    fake.files.get(ref).name = 'Folder name'
    expect(await nameOf()).to.equal('Folder name')
    fake.files.get(ref).name = undefined
    expect(await nameOf()).to.equal(ref)
  })

  it('takes a pad file with no type or size to be audio with no size, and one with no name or properties to have none', async () => {
    const fake = installFakeDrive()
    drive = fake
    const ref = await driveStorage.pads.ensureSet('Warm pads')
    await driveStorage.pads.addFile(
      ref,
      'C',
      new Blob([new Uint8Array([1, 2])], { type: 'audio/mpeg' })
    )
    const stored = [...fake.files.values()].find((file: any) => file.name === 'C.mp3')
    stored.mimeType = undefined
    stored.content = undefined
    const [file] = await driveStorage.pads.listFiles(ref)
    expect(file.type).to.equal('audio/mpeg')
    expect(file.padKey).to.equal('C')
    expect(file.size).to.equal(0)
    // ...and one with no name or properties
    stored.name = undefined
    stored.appProperties = undefined
    const [bare] = await driveStorage.pads.listFiles(ref)
    expect([bare.name, bare.padKey]).to.deep.equal(['', null])
  })

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
