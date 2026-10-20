import { expect } from '@open-wc/testing'
import { ChordlessDB, createSetlist } from '../src/js/db.ts'
import { DriveSyncManager, type FolderLink } from '../src/js/drive-sync.ts'
import { hashText } from '../src/js/song-utils.ts'
import { makeSong } from './builders.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { deleteDatabase, TEST_SPACE, wait } from './test-helpers.ts'

const { beforeEach, afterEach } = window

/** In-memory stand-in for the space's stored Drive folder link */
export const memoryFolderLink = (): FolderLink & { value: string | null } => ({
  value: null as string | null,
  async get() {
    return this.value
  },
  async set(value: string) {
    this.value = value
  },
  async clear() {
    this.value = null
  },
})

/** Give a device a song and its chart, as the app saves them */
export async function addSong(
  device: { db: ChordlessDB },
  { uuid, title, content }: { uuid: string; title: string; content: string }
) {
  const chordproFileId = `chordpro-${uuid}`
  await device.db.saveChordPro({
    id: chordproFileId,
    content,
    contentHash: hashText(content),
    lastModified: Date.now(),
  })
  await device.db.saveSong(
    makeSong({
      uuid,
      id: `title-${title.toLowerCase()}`,
      title,
      titleNormalized: title.toLowerCase(),
      chordproFileId,
    })
  )
  await wait(5)
}

/** Edit a song's chart the way the app does: new content, and the song's modifiedDate moves */
export async function editSong(device: { db: ChordlessDB }, uuid: string, content: string) {
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

/**
 * The setup the Drive sync tests share: a FakeDrive installed for each test, and simulated
 * devices (each with its own database) that sync one space through it. Call it inside
 * a describe. Its `drive` and `devices` are new for each test, so read them as `rig.drive`.
 */
export function useSyncRig() {
  const rig = {
    drive: undefined as unknown as ReturnType<typeof installFakeDrive>,
    devices: [] as any[],
    makeDevice,
    renameSpace,
    addSetlist,
    editSetlist,
    syncDevice,
    driveSetlistFiles,
    driveSetlist,
    replaceDriveFile,
  }
  const drive = () => rig.drive

  /** A simulated device: its own local database, syncing the shared space */
  async function makeDevice(
    name,
    {
      spaceName = TEST_SPACE.name,
      folderLink = memoryFolderLink(),
    }: { spaceName?: string; folderLink?: FolderLink & { value?: string | null } } = {}
  ) {
    const db = new ChordlessDB(`test-sync-${name}-${crypto.randomUUID()}`)
    await db.init()
    const memberCache = {
      value: null,
      readOnly: null as boolean | null,
      async set(members) {
        this.value = members
      },
      async setReadOnly(readOnly: boolean) {
        this.readOnly = readOnly
      },
    }
    const sync = new DriveSyncManager(spaceName, TEST_SPACE.id, { db, folderLink, memberCache })
    await sync.init()
    const device = { name, db, sync, folderLink, memberCache }
    rig.devices.push(device)
    return device
  }

  /** Rename the device's space: sync from then on uses the new name */
  async function renameSpace(device, newName) {
    device.sync = new DriveSyncManager(newName, TEST_SPACE.id, {
      db: device.db,
      folderLink: device.folderLink,
      memberCache: device.memberCache,
    })
    await device.sync.init()
  }

  async function addSetlist(device, fields = {}) {
    const setlist = { ...createSetlist({ date: '2026-10-11' }), ...fields }
    await device.db.saveSetlist(setlist)
    await wait(5)
    return setlist
  }

  /** Edit a setlist the way the app does: change it, stamp modifiedDate, save */
  async function editSetlist(device, id, changes) {
    const setlist = await device.db.getSetlist(id)
    Object.assign(setlist, changes, { modifiedDate: new Date().toISOString() })
    await device.db.saveSetlist(setlist)
    await wait(5)
  }

  async function syncDevice(device) {
    await device.sync.sync()
    await wait(5)
  }

  function driveSetlistFiles() {
    return drive().listFiles(f => f.appProperties.setlistId)
  }

  function driveSetlist(setlistId) {
    const files = drive().listFiles(f => f.appProperties.setlistId === setlistId)
    expect(files, `Drive files for setlist ${setlistId}`).to.have.length(1)
    return JSON.parse(files[0].content)
  }

  /** The Drive file `id` is replaced by a copy with another id, as when duplicates are cleaned up */
  function replaceDriveFile(id: string, newId: string) {
    const file = must(drive().files.get(id))
    drive().files.delete(id)
    file.id = newId
    drive().files.set(newId, file)
  }

  beforeEach(() => {
    rig.drive = installFakeDrive()
    rig.devices = []
  })

  afterEach(async () => {
    rig.drive.uninstall()
    for (const device of rig.devices) {
      device.db.db?.close()
      await deleteDatabase(device.db.dbName)
    }
    expect(
      rig.drive.errors.map(e => e.message),
      'FakeDrive errors'
    ).to.deep.equal([])
  })

  return rig
}
