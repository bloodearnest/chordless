import { expect } from '@open-wc/testing'
import type { Setlist } from '../src/js/data-types.ts'
import { createSetlist } from '../src/js/db.ts'
import { addDays, SHARE_DAYS_AFTER } from '../src/js/share-bundle.ts'
import { decryptBundle } from '../src/js/share-crypto.ts'
import { createShare, stopShare, syncShares } from '../src/js/share-manager.ts'
import { toLocalDateString } from '../src/js/utils/date-utils.ts'
import { makeEntry } from './builders.ts'
import { addSong, editSong, memoryFolderLink, useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, TEST_SPACE } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

/** Let the clock move on, so timestamps taken before and after differ */
const today = toLocalDateString(new Date())
const nextWeek = addDays(today, 7)

describe('Share links: sync', () => {
  const rig = useSyncRig()
  const { makeDevice } = rig
  type Device = Awaited<ReturnType<typeof makeDevice>>

  async function addSetlist(device: Device, songIds: string[], fields: Partial<Setlist> = {}) {
    const setlist = {
      ...createSetlist({ date: nextWeek }),
      owner: 'Ann Smith',
      ownerId: 'ann@example.com',
      songs: songIds.map((songId, i) =>
        makeEntry({ order: i + 1, songId, songUuid: songId, key: 'G', notes: '' })
      ),
      ...fields,
    }
    await device.db.saveSetlist(setlist)
    return setlist
  }

  const ctx = (device: Device, extra = {}) => ({
    db: device.db,
    spaceId: TEST_SPACE.id,
    space: device.sync.space,
    ...extra,
  })

  /** What a recipient would see: the file, decrypted */
  async function openShare(fileId: string, key: string) {
    const { status, bytes } = rig.storage.publicDownload(fileId)
    expect(status).to.equal(200)
    return decryptBundle(key, must(bytes) as Uint8Array<ArrayBuffer>)
  }

  const shareFiles = () => rig.storage.list(f => f.props.type === 'share')
  const updates = () => rig.storage.calls.filter(c => c.op === 'update')

  /** A device with one shared setlist of two songs, synced */
  async function sharedSetlist() {
    const phone = await makeDevice('phone')
    await addSong(phone, {
      uuid: 'a',
      title: 'Alpha',
      content: '{title: Alpha}\n{key: G}\n[G]Alpha line',
    })
    await addSong(phone, {
      uuid: 'b',
      title: 'Beta',
      content: '{title: Beta}\n{key: G}\n[G]Beta line',
    })
    const setlist = await addSetlist(phone, ['title-alpha', 'title-beta'])
    await phone.sync.sync()
    const share = await createShare(setlist, ctx(phone))
    await phone.db.saveSetlist({ ...setlist, share })
    return { phone, setlist, share }
  }

  it('shares a setlist as a public encrypted file with its charts and nothing else', async () => {
    const { share } = await sharedSetlist()

    const [file] = shareFiles()
    expect(file.ref).to.equal(share.fileId)
    expect(file.public).to.equal(true)
    expect(file.props.expires).to.equal(share.expires)
    expect(JSON.stringify(file.props)).to.not.include(share.key)

    const bundle = await openShare(share.fileId, share.key)
    expect(bundle.setlist.songs.map(s => s.title)).to.deep.equal(['Alpha', 'Beta'])
    expect(bundle.setlist.songs[0].chordpro).to.include('[G]Alpha line')
    const text = JSON.stringify(bundle)
    expect(text).to.not.include('ann@example.com')
    expect(text).to.not.include(TEST_SPACE.id)
    expect(share.expires).to.equal(addDays(nextWeek, SHARE_DAYS_AFTER))
  })

  it('records the share on the setlist, so the space has it', async () => {
    const { phone, share } = await sharedSetlist()
    await phone.sync.sync()

    const laptop = await makeDevice('laptop')
    // The same Drive folder, found by name
    await laptop.sync.sync()
    const setlists = await laptop.db.getAllSetlists()
    expect(setlists).to.have.length(1)
    expect(setlists[0].share).to.deep.equal(share)
  })

  it('leaves an unchanged share alone, and updates a changed one in place', async () => {
    const { phone, share } = await sharedSetlist()
    await phone.sync.sync()
    const before = updates().length

    await phone.sync.sync()
    expect(updates().filter(c => c.on === share.fileId)).to.have.length(0)
    expect(updates().length).to.equal(before)

    await editSong(phone, 'a', '{title: Alpha}\n{key: G}\n[G]Alpha line, fixed')
    await phone.sync.sync()

    const files = shareFiles()
    expect(files).to.have.length(1)
    expect(files[0].ref).to.equal(share.fileId)
    const bundle = await openShare(share.fileId, share.key)
    expect(bundle.setlist.songs[0].chordpro).to.include('fixed')
    const recorded = must(await phone.db.getSetlist((await phone.db.getAllSetlists())[0].id))
    expect(recorded.share?.bundleHash).to.not.equal(share.bundleHash)
    expect(recorded.share?.key).to.equal(share.key)
    expect(recorded.share?.fileId).to.equal(share.fileId)
  })

  it('updates the share when a key, note or the song list changes', async () => {
    const { phone, setlist, share } = await sharedSetlist()
    await phone.sync.sync()
    await phone.db.saveSetlist({
      ...(await phone.db.getSetlist(setlist.id)),
      songs: [
        makeEntry({ order: 1, songId: 'title-beta', songUuid: 'b', key: 'A', notes: 'repeat 4x' }),
      ],
    } as Setlist)
    await phone.sync.sync()

    const bundle = await openShare(share.fileId, share.key)
    expect(bundle.setlist.songs).to.have.length(1)
    expect(bundle.setlist.songs[0]).to.include({ title: 'Beta', key: 'A', notes: 'repeat 4x' })
  })

  it("a second leader's sync updates the share too", async () => {
    const { phone, share } = await sharedSetlist()
    await phone.sync.sync()

    const folderLink = memoryFolderLink()
    const laptop = await makeDevice('laptop', { folderLink })
    await laptop.sync.sync()
    await editSong(laptop, 'a', '{title: Alpha}\n{key: G}\n[G]Alpha line, from the laptop')
    await laptop.sync.sync()

    const bundle = await openShare(share.fileId, share.key)
    expect(bundle.setlist.songs[0].chordpro).to.include('from the laptop')
    expect(shareFiles()).to.have.length(1)
  })

  it('ends an expired share: no more downloads, trashed, and cleared from the setlist', async () => {
    const { phone, setlist, share } = await sharedSetlist()
    await phone.db.saveSetlist({
      ...(await phone.db.getSetlist(setlist.id)),
      share: { ...share, expires: addDays(today, -1) },
    } as Setlist)

    await phone.sync.sync()

    expect(rig.storage.publicDownload(share.fileId).status).to.equal(404)
    expect(rig.storage.file(share.fileId).trashed).to.equal(true)
    expect((await phone.db.getSetlist(setlist.id))?.share).to.equal(null)
    const [driveCopy] = rig.storage.list(
      f => f.props.setlistId === setlist.id && f.props.type !== 'share'
    )
    expect(JSON.parse(driveCopy.content).share).to.equal(null)
  })

  it('moves the expiry when the setlist date changes', async () => {
    const { phone, setlist, share } = await sharedSetlist()
    await phone.sync.sync()
    const later = addDays(nextWeek, 30)
    await phone.db.saveSetlist({
      ...(await phone.db.getSetlist(setlist.id)),
      date: later,
    } as Setlist)
    await phone.sync.sync()

    const recorded = must((await phone.db.getSetlist(setlist.id))?.share)
    expect(recorded.expires).to.equal(addDays(later, SHARE_DAYS_AFTER))
    expect(rig.storage.file(share.fileId).props.expires).to.equal(recorded.expires)
  })

  it('stopping a share ends access, and sharing again makes a new link', async () => {
    const { phone, setlist, share } = await sharedSetlist()
    await stopShare(share, phone.sync.space)
    await phone.db.saveSetlist({
      ...(await phone.db.getSetlist(setlist.id)),
      share: null,
    } as Setlist)
    expect(rig.storage.publicDownload(share.fileId).status).to.equal(404)

    const again = await createShare(must(await phone.db.getSetlist(setlist.id)), ctx(phone))
    expect(again.fileId).to.not.equal(share.fileId)
    expect(again.key).to.not.equal(share.key)
    expect(rig.storage.publicDownload(share.fileId).status).to.equal(404)
  })

  it('ends share files nothing points at once they are a day old, not before', async () => {
    const { phone, setlist, share } = await sharedSetlist()
    await phone.db.saveSetlist({
      ...(await phone.db.getSetlist(setlist.id)),
      share: null,
    } as Setlist)

    await syncShares(ctx(phone))
    expect(rig.storage.publicDownload(share.fileId).status, 'fresh orphan is left').to.equal(200)

    await syncShares(ctx(phone, { now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) }))
    expect(rig.storage.publicDownload(share.fileId).status).to.equal(404)
  })

  it('shares a song the library has lost by the chart edited into the setlist, and leaves out one with none', async () => {
    const { phone, setlist } = await sharedSetlist()
    const lost = (songId: string, order: number, chordproEdits?: string) =>
      makeEntry({ order, songId, songUuid: songId, key: 'G', notes: '', chordproEdits })
    const changed = {
      ...setlist,
      songs: [
        ...setlist.songs,
        lost('title-lost-with-edits', 3, '{title: Lost}\n[G]Edited here'),
        lost('title-lost-without', 4),
      ],
    }
    const share = await createShare(changed, ctx(phone))

    const bundle = await openShare(share.fileId, share.key)
    expect(bundle.setlist.songs.map(song => song.title)).to.deep.equal([
      'Alpha',
      'Beta',
      'title-lost-with-edits',
    ])
    expect(bundle.setlist.songs[2].chordpro).to.contain('Edited here')
  })

  it('leaves a share file that will not end, and ends it the next time', async () => {
    const { phone, setlist, share } = await sharedSetlist()
    await phone.db.saveSetlist({
      ...(await phone.db.getSetlist(setlist.id)),
      share: null,
    } as Setlist)
    const later = { now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) }
    rig.storage.fail('unpublish', { on: share.fileId, status: 500 })

    await syncShares(ctx(phone, later))
    expect(rig.storage.publicDownload(share.fileId).status, 'still there').to.equal(200)

    await syncShares(ctx(phone, later))
    expect(rig.storage.publicDownload(share.fileId).status).to.equal(404)
  })

  it('a failing share does not stop setlists syncing', async () => {
    const { phone, share } = await sharedSetlist()
    await editSong(phone, 'a', '{title: Alpha}\n{key: G}\n[G]changed')
    rig.storage.fail('update', { on: share.fileId, status: 500 })
    await phone.sync.sync()
    // The share was not updated, but the sync went on
    expect((await openShare(share.fileId, share.key)).setlist.songs[0].chordpro).to.not.include(
      'changed'
    )
    await addSetlist(phone, [], { name: 'Another' })
    await phone.sync.sync()
    expect((await phone.db.getAllSetlists()).map(s => s.name)).to.include('Another')
    // ...and the next sync updated the share
    expect((await openShare(share.fileId, share.key)).setlist.songs[0].chordpro).to.include(
      'changed'
    )
  })
})
