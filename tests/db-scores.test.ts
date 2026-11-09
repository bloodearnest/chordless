import { expect } from '@open-wc/testing'
import { DataChangeEvent } from '../src/js/data-changes.ts'
import { ChordlessDB } from '../src/js/db.ts'
import type { Score } from '../src/js/score.ts'
import { writeMusicXml } from '../src/js/score-musicxml.ts'
import { scoreRecord } from '../src/js/score-record.ts'
import { addSong } from './drive-harness.ts'
import { oldDatabase, SCHEMA_V14 } from './old-database.ts'
import { deleteDatabase } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

const melody: Score = {
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
    await db.saveScore(scoreRecord('song-1', xml, 'G'))
    expect((await db.getScore('song-1'))?.key).to.equal('G')
    expect(await db.getAllScores()).to.have.length(1)
    expect((await db.getScore('song-1'))?.contentHash).to.be.a('string')
    await db.deleteScore('song-1')
    expect(await db.getScore('song-1')).to.equal(undefined)
    expect(heard.filter(e => e.change.kind === 'score').map(e => e.change.ids)).to.deep.equal([
      ['song-1'],
      ['song-1'],
    ])
    // (deleting what is not there says nothing)
    heard.length = 0
    await db.deleteScore('nothing')
    expect(heard).to.have.length(0)
  })

  it('makes a melody with its first and last time of writing, and a hash that follows its score', async () => {
    const first = scoreRecord('song-1', xml, null)
    const again = scoreRecord('song-1', xmlOfT2, 'D', first)
    expect(again.createdDate).to.equal(first.createdDate)
    expect(again.key).to.equal('D')
    expect(again.contentHash).to.equal(scoreRecord('x', xmlOfT2, null).contentHash)
    expect(again.contentHash).to.not.equal(first.contentHash)
  })

  it('goes with its song, and its file is noted for the trash', async () => {
    await addSong({ db }, { uuid: 'song-1', title: 'A', content: 'x' })
    await db.saveScore({ ...scoreRecord('song-1', xml, 'G'), fileRef: 'file-9' })
    await db.deleteSong('song-1')
    expect(await db.getScore('song-1')).to.equal(undefined)
    expect((await db.getPendingDeletions()).map(p => [p.ref, p.kind])).to.deep.equal([
      ['file-9', 'score'],
    ])
  })

  it('goes with its song, and its file is noted, even when Drive no longer has the song', async () => {
    await addSong({ db }, { uuid: 'song-1', title: 'A', content: 'x' })
    await db.saveScore({ ...scoreRecord('song-1', xml, 'G'), fileRef: 'file-9' })
    await db.deleteSong('song-1', { remember: false })
    expect(await db.getScore('song-1')).to.equal(undefined)
    expect((await db.getPendingDeletions()).map(p => [p.ref, p.kind])).to.deep.equal([
      ['file-9', 'score'],
    ])
  })

  it('lets go of a file that is gone, keeping the melody, and is cleared with the rest', async () => {
    await db.saveScore({ ...scoreRecord('song-1', xml, 'G'), fileRef: 'file-9', fileRev: 'r' })
    expect(await db.unlinkFiles(new Set(['file-9']))).to.equal(1)
    expect((await db.getScore('song-1'))?.fileRef).to.equal(null)
    await db.clearSyncedData()
    expect(await db.getAllScores()).to.have.length(0)
    await db.saveScore(scoreRecord('song-2', xml, null))
    await db.clearAll()
    expect(await db.getAllScores()).to.have.length(0)
  })

  it('does not put back a melody deleted while it was being sent', async () => {
    const record = { ...scoreRecord('song-1', xml, null), fileRef: 'f', syncedContentHash: 'h' }
    await db.saveScore(record)
    await db.deleteScore('song-1')
    await db.saveScoresSent([record])
    expect(await db.getScore('song-1')).to.equal(undefined)
  })

  async function upgraded<T>(name: string, then: (db: ChordlessDB) => Promise<T>): Promise<T> {
    const db = new ChordlessDB(name)
    await db.init()
    try {
      return await then(db)
    } finally {
      db.db?.close()
      await deleteDatabase(name)
    }
  }

  it('moves the melodies of version 14 to the scores store, and marks those with a file as having an old one', async () => {
    const synced = { ...scoreRecord('song-1', xml, 'G'), fileRef: 'file-1', syncedContentHash: 'h' }
    const local = scoreRecord('song-2', xml, null)
    const name = await oldDatabase(14, SCHEMA_V14, { melodies: [synced, local] })
    await upgraded(name, async db => {
      const all = await db.getAllScores()
      expect(all.map(record => record.uuid).sort()).to.deep.equal(['song-1', 'song-2'])
      expect(await db.getScore('song-1')).to.deep.equal({ ...synced, legacyFile: true })
      // (one never sent has no file to rename)
      expect(await db.getScore('song-2')).to.deep.equal(local)
      expect(db.db?.objectStoreNames.contains('melodies')).to.equal(false)
    })
  })

  it('keeps the kind of a file waiting for the trash as a score', async () => {
    const at = new Date().toISOString()
    const name = await oldDatabase(14, SCHEMA_V14, {
      pending_deletions: [
        { ref: 'a', kind: 'melody', deletedAt: at },
        { ref: 'b', kind: 'song', deletedAt: at },
      ],
    })
    await upgraded(name, async db => {
      const pending = (await db.getPendingDeletions()).sort((a, b) => a.ref.localeCompare(b.ref))
      expect(pending.map(entry => [entry.ref, entry.kind])).to.deep.equal([
        ['a', 'score'],
        ['b', 'song'],
      ])
    })
  })

  it('clears the mark of an old file when it is sent with the new name', async () => {
    const record = { ...scoreRecord('song-1', xml, null), legacyFile: true, fileRef: 'f' }
    await db.saveScore(record)
    await db.saveScoresSent([{ ...scoreRecord('song-1', xml, null), fileRef: 'f' }])
    expect((await db.getScore('song-1'))?.legacyFile).to.equal(undefined)
  })
})
