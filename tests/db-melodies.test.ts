import { expect } from '@open-wc/testing'
import { DataChangeEvent } from '../src/js/data-changes.ts'
import { ChordlessDB } from '../src/js/db.ts'
import type { Melody } from '../src/js/melody.ts'
import { writeMusicXml } from '../src/js/melody-musicxml.ts'
import { melodyRecord } from '../src/js/melody-record.ts'
import { addSong } from './drive-harness.ts'
import { deleteDatabase } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

const melody: Melody = {
  title: 'T',
  notice: [],
  measures: [
    {
      number: 1,
      voices: [[]],
      chords: [],
      section: null,
      barline: 'single',
      directions: [],
      repeatStart: false,
      ending: null,
      length: 4,
      full: true,
      fifths: 0,
      beats: 4,
      beatType: 4,
      tempo: null,
    },
  ],
}

const xml = writeMusicXml(melody)
const xmlOfT2 = writeMusicXml({ ...melody, title: 'T2' })

describe('the melodies store', () => {
  let db: ChordlessDB
  const heard: DataChangeEvent[] = []
  const listener = (event: Event) => heard.push(event as DataChangeEvent)

  beforeEach(async () => {
    db = new ChordlessDB(`test-melodies-${crypto.randomUUID()}`)
    await db.init()
    heard.length = 0
    window.addEventListener(DataChangeEvent.type, listener)
  })
  afterEach(async () => {
    window.removeEventListener(DataChangeEvent.type, listener)
    db.db?.close()
    await deleteDatabase(db.dbName)
  })

  it('keeps a melody by its song, and says so when it is written or deleted', async () => {
    await db.saveMelody(melodyRecord('song-1', xml, 'G'))
    expect((await db.getMelody('song-1'))?.key).to.equal('G')
    expect(await db.getAllMelodies()).to.have.length(1)
    expect((await db.getMelody('song-1'))?.contentHash).to.be.a('string')
    await db.deleteMelody('song-1')
    expect(await db.getMelody('song-1')).to.equal(undefined)
    expect(heard.filter(e => e.change.kind === 'melody').map(e => e.change.ids)).to.deep.equal([
      ['song-1'],
      ['song-1'],
    ])
    // (deleting what is not there says nothing)
    heard.length = 0
    await db.deleteMelody('nothing')
    expect(heard).to.have.length(0)
  })

  it('makes a melody with its first and last time of writing, and a hash that follows its score', async () => {
    const first = melodyRecord('song-1', xml, null)
    const again = melodyRecord('song-1', xmlOfT2, 'D', first)
    expect(again.createdDate).to.equal(first.createdDate)
    expect(again.key).to.equal('D')
    expect(again.contentHash).to.equal(melodyRecord('x', xmlOfT2, null).contentHash)
    expect(again.contentHash).to.not.equal(first.contentHash)
  })

  it('goes with its song, and its file is noted for the trash', async () => {
    await addSong({ db }, { uuid: 'song-1', title: 'A', content: 'x' })
    await db.saveMelody({ ...melodyRecord('song-1', xml, 'G'), fileRef: 'file-9' })
    await db.deleteSong('song-1')
    expect(await db.getMelody('song-1')).to.equal(undefined)
    expect((await db.getPendingDeletions()).map(p => [p.ref, p.kind])).to.deep.equal([
      ['file-9', 'melody'],
    ])
  })

  it('goes with its song, and its file is noted, even when Drive no longer has the song', async () => {
    await addSong({ db }, { uuid: 'song-1', title: 'A', content: 'x' })
    await db.saveMelody({ ...melodyRecord('song-1', xml, 'G'), fileRef: 'file-9' })
    await db.deleteSong('song-1', { remember: false })
    expect(await db.getMelody('song-1')).to.equal(undefined)
    expect((await db.getPendingDeletions()).map(p => [p.ref, p.kind])).to.deep.equal([
      ['file-9', 'melody'],
    ])
  })

  it('lets go of a file that is gone, keeping the melody, and is cleared with the rest', async () => {
    await db.saveMelody({ ...melodyRecord('song-1', xml, 'G'), fileRef: 'file-9', fileRev: 'r' })
    expect(await db.unlinkFiles(new Set(['file-9']))).to.equal(1)
    expect((await db.getMelody('song-1'))?.fileRef).to.equal(null)
    await db.clearSyncedData()
    expect(await db.getAllMelodies()).to.have.length(0)
    await db.saveMelody(melodyRecord('song-2', xml, null))
    await db.clearAll()
    expect(await db.getAllMelodies()).to.have.length(0)
  })

  it('does not put back a melody deleted while it was being sent', async () => {
    const record = { ...melodyRecord('song-1', xml, null), fileRef: 'f', syncedContentHash: 'h' }
    await db.saveMelody(record)
    await db.deleteMelody('song-1')
    await db.saveMelodiesSent([record])
    expect(await db.getMelody('song-1')).to.equal(undefined)
  })

  it('clears the melodies of the version that kept them parsed, which are pulled or read again', async () => {
    const name = `test-melodies-v13-${crypto.randomUUID()}`
    // a database as version 13 left it: a melody was the parsed object
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 13)
      request.onupgradeneeded = () => {
        for (const [store, keyPath] of [
          ['songs', 'id'],
          ['setlists', 'id'],
          ['melodies', 'uuid'],
        ] as const) {
          request.result.createObjectStore(store, { keyPath })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = old.transaction('melodies', 'readwrite')
      tx.objectStore('melodies').put({ uuid: 'song-1', melody, key: 'G', contentHash: 'h' })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    old.close()

    const upgraded = new ChordlessDB(name)
    await upgraded.init()
    try {
      expect(await upgraded.getAllMelodies()).to.deep.equal([])
      await upgraded.saveMelody(melodyRecord('song-1', xml, 'G'))
      expect((await upgraded.getMelody('song-1'))?.xml).to.equal(xml)
    } finally {
      upgraded.db?.close()
      await deleteDatabase(name)
    }
  })
})
