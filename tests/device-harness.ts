import { expect } from '@open-wc/testing'
import { ChordlessDB, createSetlist } from '../src/js/db.ts'
import { hashText } from '../src/js/song-utils.ts'
import { makeSong } from './builders.ts'
import { installFakeDrive } from './fake-drive.ts'
import { deleteDatabase, nextTimestamp } from './test-helpers.ts'

const { beforeEach, afterEach } = window

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
  await nextTimestamp()
}

/**
 * Simulated devices, each with a database of its own, and the helpers that put records in them the way the app does. Call it
 * inside a describe: the devices are closed after each test.
 */
export function useDevices() {
  const devices: { name: string; db: ChordlessDB }[] = []

  async function makeDevice(name: string) {
    const db = new ChordlessDB(`test-device-${name}-${crypto.randomUUID()}`)
    await db.init()
    const device = { name, db }
    devices.push(device)
    return device
  }

  async function addSetlist(device: { db: ChordlessDB }, fields = {}) {
    const setlist = { ...createSetlist({ date: '2026-10-11' }), ...fields }
    await device.db.saveSetlist(setlist)
    await nextTimestamp()
    return setlist
  }

  afterEach(async () => {
    for (const device of devices.splice(0)) {
      device.db.db?.close()
      await deleteDatabase(device.db.dbName)
    }
  })

  return { makeDevice, addSetlist }
}

/**
 * An in-memory fake of the parts of the Drive v3 API the app still uses (tests/fake-drive.ts): its `drive` is new for each
 * test, so read it as `rig.drive`.
 */
export function useFakeDriveRig() {
  const rig = { drive: undefined as unknown as ReturnType<typeof installFakeDrive> }

  beforeEach(() => {
    rig.drive = installFakeDrive()
  })

  afterEach(() => {
    rig.drive.uninstall()
    expect(
      rig.drive.errors.map(e => e.message),
      'FakeDrive errors'
    ).to.deep.equal([])
  })

  return rig
}
