import { expect } from '@open-wc/testing'
import { ROOT_FOLDER_NAME } from '../src/js/drive-client.ts'
import { driveStorage } from '../src/js/storage/browser-drive.ts'
import { ChangeTokenLost } from '../src/js/storage/types.ts'
import { type FakeDrive, installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
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

  describe('share files', () => {
    const share = {
      name: 'setlist-1.share',
      props: { type: 'share' },
      type: 'application/octet-stream',
    }
    // Every byte value, so anything that treated the file as text would corrupt it
    const allBytes = Uint8Array.from({ length: 256 }, (_, i) => i)

    async function makeSpace() {
      const fake = installFakeDrive()
      drive = fake
      const root = await driveStorage.ensureRoot('Grace Church', 'space-1')
      return { fake, space: driveStorage.space(root.ref) }
    }

    it('is made readable by anyone with the link, though not discoverable, in a shares folder of its own', async () => {
      const { fake, space } = await makeSpace()
      const { file } = await space.create('shares', share, allBytes, { publicLink: true })
      const stored = fake.files.get(file.ref)
      expect(stored.parents).to.deep.equal([
        fake.findByPath([ROOT_FOLDER_NAME, 'Grace Church', 'shares']).id,
      ])
      expect(stored.permissions).to.deep.equal([
        { id: 'anyoneWithLink', type: 'anyone', role: 'reader', allowFileDiscovery: false },
      ])
      expect(
        fake.findByPath([ROOT_FOLDER_NAME, 'Grace Church', 'shares']).permissions
      ).to.deep.equal([])
      expect(fake.anonymousDownload(file.ref)).to.deep.equal({ status: 200, bytes: allBytes })
    })

    it('is updated in place: the same ref, new content, the link unchanged', async () => {
      const { fake, space } = await makeSpace()
      const { file } = await space.create('shares', share, new Uint8Array([1, 2, 3]), {
        publicLink: true,
      })
      const updated = await space.update(file.ref, share, new Uint8Array([9, 8, 7]))
      expect(updated.file.ref).to.equal(file.ref)
      expect(updated.file.rev).to.not.equal(file.rev)
      expect(Array.from(must(fake.anonymousDownload(file.ref).bytes))).to.deep.equal([9, 8, 7])
      expect(fake.files.get(file.ref).permissions).to.have.length(1)
    })

    it('ends by taking back the link as well as binning the file, never by deleting it', async () => {
      const { fake, space } = await makeSpace()
      const { file } = await space.create('shares', share, new Uint8Array([1]), {
        publicLink: true,
      })
      // Binning alone would leave it public, as real Drive does
      fake.files.get(file.ref).trashed = true
      expect(fake.anonymousDownload(file.ref).status).to.equal(200)
      fake.files.get(file.ref).trashed = false

      await space.unpublish(file.ref)
      await space.trash(file.ref)

      expect(fake.anonymousDownload(file.ref).status).to.equal(404)
      expect(fake.files.get(file.ref).trashed).to.equal(true)
      expect(fake.files.has(file.ref)).to.equal(true)
    })

    it('is binned again if it cannot be made public, and says why', async () => {
      const { fake, space } = await makeSpace()
      fake.failRequests({ method: 'POST', path: /permissions/, status: 403 })
      let error: (Error & { status?: number }) | undefined
      await space.create('shares', share, new Uint8Array([1]), { publicLink: true }).catch(e => {
        error = e
      })
      expect(error?.message).to.match(/403/)
      expect(error?.message).to.contain(
        'your organisation may not allow links that anyone can open'
      )
      expect(error?.message).to.contain('song list to paste still works')
      expect(error?.status).to.equal(403)
      const [leftover] = fake.listFiles((f: any) => f.name === 'setlist-1.share')
      expect(leftover.trashed).to.equal(true)
    })

    it('does not blame the space for a failure that is not a refusal', async () => {
      const { fake, space } = await makeSpace()
      for (const status of [401, 429, 500]) {
        fake.failRequests({ method: 'POST', path: /permissions/, status })
        let error: Error | undefined
        await space.create('shares', share, new Uint8Array([1]), { publicLink: true }).catch(e => {
          error = e
        })
        expect(error?.message, String(status)).to.contain(String(status))
        expect(error?.message, String(status)).to.not.contain('organisation')
      }
      fake.failRequests({ method: 'POST', path: /permissions/, network: true })
      let offline: Error | undefined
      await space.create('shares', share, new Uint8Array([1]), { publicLink: true }).catch(e => {
        offline = e
      })
      expect(offline?.message).to.not.contain('organisation')
    })
  })

  it('does not make a shares folder for a space that never shares', async () => {
    const fake = installFakeDrive()
    drive = fake
    const root = await driveStorage.ensureRoot('Grace Church', 'space-1')
    expect(await driveStorage.space(root.ref).list('shares')).to.deep.equal([])
    expect(fake.findByPath([ROOT_FOLDER_NAME, 'Grace Church', 'shares'])).to.equal(null)
    await driveStorage
      .space(root.ref)
      .create('shares', { name: 'a.share', props: {}, type: 'application/octet-stream' }, 'x')
    expect(fake.findByPath([ROOT_FOLDER_NAME, 'Grace Church', 'shares'])).to.not.equal(null)
  })
})

describe('Google Drive (on FakeDrive): the feed of changes', () => {
  const song = { name: 'a.txt', props: { songUuid: 's1' }, type: 'text/plain' }
  const setlist = {
    name: '2026-10-25-x.json',
    props: { setlistId: 'l1' },
    type: 'application/json',
  }

  async function openSpace() {
    const fake = installFakeDrive()
    drive = fake
    const space = driveStorage.space((await driveStorage.ensureRoot('Grace Church', 's')).ref)
    return { fake, space, feed: must(space.changes) }
  }

  it('shows nothing until something changes, then the files that did, by collection', async () => {
    const { space, feed } = await openSpace()
    const start = await feed.start()
    expect(await feed.since(start)).to.deep.include({ changed: [], gone: [] })

    const a = await space.create('songs', song, 'chart')
    const b = await space.create('setlists', setlist, '{}')
    const seen = await feed.since(start)
    expect(seen.changed.map(c => [c.collection, c.file.ref])).to.have.deep.members([
      ['songs', a.file.ref],
      ['setlists', b.file.ref],
    ])
    expect(seen.changed[0].file.rev).to.be.a('string')
    expect(seen.gone).to.deep.equal([])

    // (the next position starts after these)
    expect(await feed.since(seen.token)).to.deep.include({ changed: [], gone: [] })
    await space.update(a.file.ref, song, 'chart, fixed')
    const next = await feed.since(seen.token)
    expect(next.changed.map(c => c.file.ref)).to.deep.equal([a.file.ref])
  })

  it('lists a file once, as it is now, however often it changed', async () => {
    const { space, feed } = await openSpace()
    const start = await feed.start()
    const { file } = await space.create('songs', song, 'one')
    await space.update(file.ref, song, 'two')
    await space.update(file.ref, song, 'three')
    const seen = await feed.since(start)
    expect(seen.changed).to.have.length(1)
    expect(seen.changed[0].file.rev).to.equal((await space.list('songs'))[0].rev)
  })

  it('says a file is gone when it is in the bin, deleted for good, or not in this space', async () => {
    const { fake, space, feed } = await openSpace()
    const kept = await space.create('songs', song, 'x')
    const binned = await space.create('songs', { ...song, name: 'b.txt' }, 'x')
    const deleted = await space.create('setlists', setlist, '{}')
    const start = await feed.start()

    await space.trash(binned.file.ref)
    fake.files.delete(deleted.file.ref)
    fake.deletedAt.push({ id: deleted.file.ref, seq: ++fake.changeSeq })
    const other = driveStorage.space((await driveStorage.ensureRoot('Elsewhere', 'e')).ref)
    const there = await other.create('songs', { ...song, name: 'there.txt' }, 'x')

    const seen = await feed.since(start)
    expect(seen.gone).to.include.members([binned.file.ref, deleted.file.ref, there.file.ref])
    expect(seen.changed.map(c => c.file.ref)).to.not.include(kept.file.ref)
  })

  it('has nothing to say of the files of a space with no folders yet, and lists nothing to say so', async () => {
    const { fake, feed } = await openSpace()
    const start = await feed.start()
    fake.requests.length = 0

    expect(await feed.since(start)).to.deep.include({ changed: [], gone: [] })

    const lists = fake.requests.filter(
      (request: { path: string; params: URLSearchParams }) =>
        request.path.endsWith('/files') && request.params.has('q')
    )
    expect(lists, 'a feed with no change is one request').to.have.length(0)
    expect(fake.requests).to.have.length(1)
  })

  it('lists the space’s folders once, to tell which collection a change is in, when there is one', async () => {
    const { fake, space, feed } = await openSpace()
    const start = await feed.start()
    await space.create('songs', { ...song, name: 'a.txt' }, 'x')
    await space.create('songs', { ...song, name: 'b.txt' }, 'x')
    fake.requests.length = 0

    expect((await feed.since(start)).changed).to.have.length(2)

    const lists = fake.requests.filter(
      (request: { path: string; params: URLSearchParams }) =>
        request.path.endsWith('/files') && request.params.has('q')
    )
    expect(lists).to.have.length(1)
  })

  describe('after the inventory, which listed the whole space', () => {
    type Request = { path: string; params: URLSearchParams }
    const queries = (fake: { requests: Request[] }) =>
      fake.requests.filter(request => request.path.endsWith('/files') && request.params.has('q'))

    it('lists the collections from it, as a listing of their own would, and asks Drive nothing', async () => {
      const { fake, space } = await openSpace()
      await space.create('songs', { ...song, name: 'a.txt' }, 'x')
      await space.create('songs', { ...song, name: 'b.txt' }, 'x')
      await space.create('setlists', { ...setlist, name: 'old.json' }, '{}')
      await space.create('setlists', { ...setlist, name: 'new.json' }, '{}')
      const songs = await space.list('songs')
      const setlists = await space.list('setlists')
      const shares = await space.list('shares')

      await space.inventory()
      fake.requests.length = 0

      expect(await space.list('songs')).to.deep.equal(songs)
      expect(await space.list('setlists')).to.deep.equal(setlists)
      expect(await space.list('shares'), 'no shares folder: nothing to list').to.deep.equal(shares)
      expect(fake.requests).to.have.length(0)
    })

    it('finds the collections’ folders in it, without looking for them by name', async () => {
      const { fake, space } = await openSpace()
      await space.create('songs', song, 'x')
      await space.create('setlists', setlist, '{}')
      // (a space that has not been touched since: its folders are found, as a new sync finds them)
      const fresh = driveStorage.space((await driveStorage.ensureRoot('Grace Church', 's')).ref)
      await fresh.inventory()
      fake.requests.length = 0

      await fresh.create('songs', { ...song, name: 'more.txt' }, 'x')

      expect(fake.requests.filter(request => request.params.has('q'))).to.have.length(0)
    })

    it('forgets what it listed when something is written, so a list shows the write', async () => {
      const { space } = await openSpace()
      const first = await space.create('songs', { ...song, name: 'a.txt' }, 'x')
      await space.inventory()
      expect(await space.list('songs')).to.have.length(1)

      await space.create('songs', { ...song, name: 'b.txt' }, 'x')
      expect(await space.list('songs')).to.have.length(2)

      await space.inventory()
      await space.trash(first.file.ref)
      expect((await space.list('songs')).map(file => file.name)).to.deep.equal(['b.txt'])
    })

    it('looks for a folder itself when the space has two of the name', async () => {
      const { fake, space } = await openSpace()
      await space.create('songs', song, 'x')
      const songs = [...fake.files.values()].find(file => file.name === 'songs')
      fake.files.set('twin', { ...songs, id: 'twin' })
      const fresh = driveStorage.space((await driveStorage.ensureRoot('Grace Church', 's')).ref)
      await fresh.inventory()
      fake.requests.length = 0

      await fresh.create('songs', { ...song, name: 'more.txt' }, 'x')

      expect(queries(fake).length, 'which of two is it: Drive is asked').to.be.greaterThan(0)
    })
  })

  it('reads every page of changes', async () => {
    const { fake, space, feed } = await openSpace()
    const start = await feed.start()
    fake.maxPageSize = 2
    for (let i = 0; i < 5; i++) await space.create('songs', { ...song, name: `${i}.txt` }, 'x')
    expect((await feed.since(start)).changed).to.have.length(5)
  })

  it('says it has forgotten a position that is too old or not its own, and passes on other errors', async () => {
    const { fake, space, feed } = await openSpace()
    const old = await feed.start()
    await space.create('songs', song, 'x')
    fake.forgetChangePositions()
    let thrown: unknown
    try {
      await feed.since(old)
    } catch (error) {
      thrown = error
    }
    expect(thrown).to.be.instanceOf(ChangeTokenLost)
    expect((await feed.since(await feed.start())).changed).to.deep.equal([])

    fake.failRequests({ path: /\/changes\?/, status: 500 })
    let failed: unknown
    try {
      await feed.since(await feed.start())
    } catch (error) {
      failed = error
    }
    expect(failed).to.be.instanceOf(Error)
    expect(failed).to.not.be.instanceOf(ChangeTokenLost)
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
