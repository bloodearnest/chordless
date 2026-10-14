import { expect } from '@open-wc/testing'
import type { Setlist } from '../src/js/data-types.ts'
import { ChordlessDB, createSetlist } from '../src/js/db.ts'
import { DriveSyncManager, type FolderLink } from '../src/js/drive-sync.ts'
import { addDays, SHARE_DAYS_AFTER } from '../src/js/share-bundle.ts'
import { decryptBundle } from '../src/js/share-crypto.ts'
import { createShare, stopShare, syncShares } from '../src/js/share-manager.ts'
import { hashText } from '../src/js/song-utils.ts'
import { toLocalDateString } from '../src/js/utils/date-utils.ts'
import { makeEntry } from './builders.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs, TEST_ORG, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

/** Let the clock move on, so timestamps taken before and after differ */
const today = toLocalDateString(new Date())
const nextWeek = addDays(today, 7)

describe('Share links: sync', () => {
  let drive
  let devices: Device[]

  interface Device {
    db: ChordlessDB
    sync: DriveSyncManager
  }

  const folderLink = (): FolderLink => {
    let value: string | null = null
    return {
      async get() {
        return value
      },
      async set(v) {
        value = v
      },
    }
  }

  async function makeDevice(name: string, link = folderLink()): Promise<Device> {
    const db = new ChordlessDB(`test-share-${name}-${crypto.randomUUID()}`)
    await db.init()
    const memberCache = { async set() {} }
    const sync = new DriveSyncManager(TEST_ORG.name, TEST_ORG.id, {
      db,
      folderLink: link,
      memberCache,
    })
    await sync.init()
    const device = { db, sync }
    devices.push(device)
    return device
  }

  async function addSong(device: Device, uuid: string, title: string, content: string) {
    await device.db.saveChordPro({
      id: `chordpro-${uuid}`,
      content,
      contentHash: hashText(content),
      lastModified: Date.now(),
    })
    await device.db.saveSong({
      uuid,
      id: `title-${title.toLowerCase()}`,
      title,
      titleNormalized: title.toLowerCase(),
      isDefault: true,
      variantOf: null,
      chordproFileId: `chordpro-${uuid}`,
      modifiedDate: new Date().toISOString(),
    } as never)
  }

  /** Edit a song's chart the way the app does */
  async function editSong(device: Device, uuid: string, content: string) {
    const song = must(await device.db.getSong(uuid))
    await device.db.saveChordPro({
      id: song.chordproFileId,
      content,
      contentHash: hashText(content),
      lastModified: Date.now(),
    })
    song.modifiedDate = new Date().toISOString()
    await device.db.saveSong(song)
    await wait(5)
  }

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
    organisationId: TEST_ORG.id,
    organisationFolderId: must(device.sync.driveFolderId),
    ...extra,
  })

  /** What a recipient would see: the file, decrypted */
  async function openShare(fileId: string, key: string) {
    const { status, bytes } = drive.anonymousDownload(fileId)
    expect(status).to.equal(200)
    return decryptBundle(key, bytes)
  }

  const shareFiles = () =>
    [...drive.files.values()].filter((f: any) => f.appProperties?.type === 'share')
  const uploads = () =>
    drive.requests.filter(r => r.method === 'PATCH' && r.path.startsWith('/upload'))

  beforeEach(() => {
    drive = installFakeDrive()
    devices = []
  })

  afterEach(async () => {
    drive.uninstall()
    for (const device of devices) {
      device.db.db?.close()
      await deleteDatabase(device.db.dbName)
    }
    expect(drive.errors.map(e => e.message)).to.deep.equal([])
  })

  /** A device with one shared setlist of two songs, synced */
  async function sharedSetlist() {
    const phone = await makeDevice('phone', folderLink())
    await addSong(phone, 'a', 'Alpha', '{title: Alpha}\n{key: G}\n[G]Alpha line')
    await addSong(phone, 'b', 'Beta', '{title: Beta}\n{key: G}\n[G]Beta line')
    const setlist = await addSetlist(phone, ['title-alpha', 'title-beta'])
    await phone.sync.sync()
    const share = await createShare(setlist, ctx(phone))
    await phone.db.saveSetlist({ ...setlist, share })
    return { phone, setlist, share }
  }

  it('shares a setlist as a public encrypted file with its charts and nothing else', async () => {
    const { share } = await sharedSetlist()

    const [file] = shareFiles()
    expect(file.id).to.equal(share.fileId)
    expect(file.permissions.map(p => p.type)).to.deep.equal(['anyone'])
    expect(file.appProperties.expires).to.equal(share.expires)
    expect(JSON.stringify(file.appProperties)).to.not.include(share.key)

    const bundle = await openShare(share.fileId, share.key)
    expect(bundle.setlist.songs.map(s => s.title)).to.deep.equal(['Alpha', 'Beta'])
    expect(bundle.setlist.songs[0].chordpro).to.include('[G]Alpha line')
    const text = JSON.stringify(bundle)
    expect(text).to.not.include('ann@example.com')
    expect(text).to.not.include(TEST_ORG.id)
    expect(share.expires).to.equal(addDays(nextWeek, SHARE_DAYS_AFTER))
  })

  it('records the share on the setlist, so the organisation has it', async () => {
    const { phone, share } = await sharedSetlist()
    await phone.sync.sync()

    const laptop = await makeDevice('laptop', folderLink())
    // The same Drive folder, found by name
    await laptop.sync.sync()
    const setlists = await laptop.db.getAllSetlists()
    expect(setlists).to.have.length(1)
    expect(setlists[0].share).to.deep.equal(share)
  })

  it('leaves an unchanged share alone, and updates a changed one in place', async () => {
    const { phone, share } = await sharedSetlist()
    await phone.sync.sync()
    const before = uploads().length

    await phone.sync.sync()
    expect(uploads().filter(r => r.path.includes(share.fileId))).to.have.length(0)
    expect(uploads().length).to.equal(before)

    await editSong(phone, 'a', '{title: Alpha}\n{key: G}\n[G]Alpha line, fixed')
    await phone.sync.sync()

    const files = shareFiles()
    expect(files).to.have.length(1)
    expect(files[0].id).to.equal(share.fileId)
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

    const link = folderLink()
    const laptop = await makeDevice('laptop', link)
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

    expect(drive.anonymousDownload(share.fileId).status).to.equal(404)
    expect(drive.files.get(share.fileId).trashed).to.equal(true)
    expect(drive.files.has(share.fileId), 'trashed, never deleted').to.equal(true)
    expect((await phone.db.getSetlist(setlist.id))?.share).to.equal(null)
    const driveCopy = [...drive.files.values()].find(
      (f: any) => f.appProperties.setlistId === setlist.id && f.appProperties.type !== 'share'
    ) as any
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
    expect(drive.files.get(share.fileId).appProperties.expires).to.equal(recorded.expires)
  })

  it('stopping a share ends access, and sharing again makes a new link', async () => {
    const { phone, setlist, share } = await sharedSetlist()
    await stopShare(share)
    await phone.db.saveSetlist({
      ...(await phone.db.getSetlist(setlist.id)),
      share: null,
    } as Setlist)
    expect(drive.anonymousDownload(share.fileId).status).to.equal(404)

    const again = await createShare(must(await phone.db.getSetlist(setlist.id)), ctx(phone))
    expect(again.fileId).to.not.equal(share.fileId)
    expect(again.key).to.not.equal(share.key)
    expect(drive.anonymousDownload(share.fileId).status).to.equal(404)
  })

  it('ends share files nothing points at once they are a day old, not before', async () => {
    const { phone, setlist, share } = await sharedSetlist()
    await phone.db.saveSetlist({
      ...(await phone.db.getSetlist(setlist.id)),
      share: null,
    } as Setlist)

    await syncShares(ctx(phone))
    expect(drive.anonymousDownload(share.fileId).status, 'fresh orphan is left').to.equal(200)

    await syncShares(ctx(phone, { now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) }))
    expect(drive.anonymousDownload(share.fileId).status).to.equal(404)
  })

  it('does not make a shares folder for an organisation that never shares', async () => {
    const phone = await makeDevice('phone', folderLink())
    await addSetlist(phone, [])
    await phone.sync.sync()
    expect(drive.findByPath(['Chordless', TEST_ORG.name, 'shares'])).to.equal(null)
  })

  it('a failing share does not stop setlists syncing', async () => {
    const { phone, share } = await sharedSetlist()
    await editSong(phone, 'a', '{title: Alpha}\n{key: G}\n[G]changed')
    drive.failRequests({
      method: 'PATCH',
      path: new RegExp(`upload.*${share.fileId}`),
      status: 500,
      times: 1,
    })
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
