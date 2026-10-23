import { expect } from '@open-wc/testing'
import { ChordlessDB, createSetlist } from '../src/js/db.ts'
import { type ChangeTokenStore, DriveSyncManager, type FolderLink } from '../src/js/drive-sync.ts'
import { hashText } from '../src/js/song-utils.ts'
import type { StorageBackend } from '../src/js/storage/types.ts'
import { makeSong } from './builders.ts'
import { installFakeDrive } from './fake-drive.ts'
import { MemoryStorage } from './memory-storage.ts'
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

/** In-memory stand-in for the space's stored place in the feed of changes */
export const memoryChangeToken = (): ChangeTokenStore & { value: string | null } => ({
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
 * What the two sync rigs share: simulated devices (each with its own database) that sync one space
 * through a storage backend, and the helpers that edit their records the way the app does.
 */
function makeRig(storage: () => StorageBackend | undefined) {
  const devices: any[] = []

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
    const changeToken = memoryChangeToken()
    const sync = new DriveSyncManager(spaceName, TEST_SPACE.id, {
      db,
      folderLink,
      memberCache,
      changeToken,
      storage: storage(),
    })
    await sync.init()
    const device = { name, db, sync, folderLink, memberCache, changeToken }
    devices.push(device)
    return device
  }

  /** Rename the device's space: sync from then on uses the new name */
  async function renameSpace(device, newName) {
    device.sync = new DriveSyncManager(newName, TEST_SPACE.id, {
      db: device.db,
      folderLink: device.folderLink,
      memberCache: device.memberCache,
      changeToken: device.changeToken,
      storage: storage(),
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

  async function closeDevices() {
    for (const device of devices.splice(0)) {
      device.db.db?.close()
      await deleteDatabase(device.db.dbName)
    }
  }

  return { devices, makeDevice, renameSpace, addSetlist, editSetlist, syncDevice, closeDevices }
}

/**
 * The setup the sync tests share: a MemoryStorage (tests/memory-storage.ts) for each test, and
 * simulated devices that sync one space through it. Call it inside a describe. Its `storage` and
 * `devices` are new for each test, so read them as `rig.storage`. For what the engine does with
 * any backend; what Drive does on the wire is tested through useFakeDriveRig.
 */
export function useSyncRig() {
  // (the devices read the storage through this, not through `rig`: an object that refers to itself
  // in its own initializer has a type that depends on the order the files are checked in)
  const current = { storage: new MemoryStorage() }
  const rig = {
    storage: current.storage,
    ...makeRig(() => current.storage),
    driveSetlistFiles,
    driveSetlist,
    replaceDriveFile,
  }

  /** The file `ref` is replaced by a copy with another ref, as when duplicates are cleaned up */
  function replaceDriveFile(ref: string, newRef: string) {
    rig.storage.rekey(ref, newRef)
  }

  function driveSetlistFiles() {
    return rig.storage.list(f => Boolean(f.props.setlistId))
  }

  function driveSetlist(setlistId) {
    const files = rig.storage.list(f => f.props.setlistId === setlistId)
    expect(files, `Files for setlist ${setlistId}`).to.have.length(1)
    return JSON.parse(files[0].content)
  }

  beforeEach(() => {
    current.storage = new MemoryStorage()
    rig.storage = current.storage
  })

  afterEach(async () => {
    await rig.closeDevices()
  })

  return rig
}

/**
 * The same, against FakeDrive (tests/fake-drive.ts), an in-memory fake of the parts of the Drive v3
 * API the app uses, so the real drive-api.ts and the Drive adapter run too: for tests of what is
 * sent to Drive and how its answers are read, and of the parts that still call Drive directly
 * (share links, pads). Its `drive` and `devices` are new for each test: read them as `rig.drive`.
 */
export function useFakeDriveRig() {
  const rig = {
    drive: undefined as unknown as ReturnType<typeof installFakeDrive>,
    ...makeRig(() => undefined),
    driveSetlistFiles,
    driveSetlist,
    replaceDriveFile,
  }
  const drive = () => rig.drive

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
  })

  afterEach(async () => {
    rig.drive.uninstall()
    await rig.closeDevices()
    expect(
      rig.drive.errors.map(e => e.message),
      'FakeDrive errors'
    ).to.deep.equal([])
  })

  return rig
}
