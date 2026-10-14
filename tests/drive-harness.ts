import { expect } from '@open-wc/testing'
import { ChordlessDB, createSetlist } from '../src/js/db.ts'
import { DriveSyncManager, type FolderLink } from '../src/js/drive-sync.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { deleteDatabase, TEST_ORG, wait } from './test-helpers.ts'

const { beforeEach, afterEach } = window

/** In-memory stand-in for the organisation's stored Drive folder link */
export const memoryFolderLink = (): FolderLink & { value: string | null } => ({
  value: null as string | null,
  async get() {
    return this.value
  },
  async set(value: string) {
    this.value = value
  },
})

/**
 * The setup the Drive sync tests share: a FakeDrive installed for each test, and simulated
 * devices (each with its own database) that sync one organisation through it. Call it inside
 * a describe. Its `drive` and `devices` are new for each test, so read them as `rig.drive`.
 */
export function useSyncRig() {
  const rig = {
    drive: undefined as unknown as ReturnType<typeof installFakeDrive>,
    devices: [] as any[],
    makeDevice,
    renameOrganisation,
    addSetlist,
    editSetlist,
    syncDevice,
    driveSetlistFiles,
    driveSetlist,
    replaceDriveFile,
  }
  const drive = () => rig.drive

  /** In-memory stand-in for the organisation's stored Drive folder link */
  const memoryFolderLink = (): FolderLink & { value: string | null } => ({
    value: null as string | null,
    async get() {
      return this.value
    },
    async set(value: string) {
      this.value = value
    },
  })

  /** A simulated device: its own local database, syncing the shared org */
  async function makeDevice(
    name,
    {
      orgName = TEST_ORG.name,
      folderLink = memoryFolderLink(),
    }: { orgName?: string; folderLink?: FolderLink & { value?: string | null } } = {}
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
    const sync = new DriveSyncManager(orgName, TEST_ORG.id, { db, folderLink, memberCache })
    await sync.init()
    const device = { name, db, sync, folderLink, memberCache }
    rig.devices.push(device)
    return device
  }

  /** Rename the device's organisation: sync from then on uses the new name */
  async function renameOrganisation(device, newName) {
    device.sync = new DriveSyncManager(newName, TEST_ORG.id, {
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
