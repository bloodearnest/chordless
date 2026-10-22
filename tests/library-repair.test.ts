/**
 * Cleaning up a library (library-repair.ts): which charts are the same chart, which songs are the
 * same song twice and which of them to keep, what source each song should have, and applying a plan
 * to a real database: the setlists that used the songs removed use the one kept, and show what they
 * showed.
 */
import { expect } from '@open-wc/testing'
import type { SongRecord } from '../src/js/data-types.ts'
import { ChordlessDB } from '../src/js/db.ts'
import {
  applyRepair,
  chartFingerprint,
  hasCcliBumph,
  keyOfChart,
  planMerge,
  planRepair,
  planSources,
  type SongWithText,
  usageOf,
} from '../src/js/library-repair.ts'
import { hashText } from '../src/js/song-utils.ts'
import { makeEntry, makeSetlist, makeSong } from './builders.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const BUMPH = `{ccli_license: 123}\n{footer: For use solely with the SongSelect® Terms of Use. www.ccli.com}`
const chart = (key: string, chords: [string, string, string], extra = '') =>
  `{title: Amazing}\n{key: ${key}}\n{tempo: 70}\n{copyright: 2017 Somebody}\n${extra}{comment: Verse 1}\n` +
  `[${chords[0]}]Amazing [${chords[1]}]grace how [${chords[2]}]sweet\n` +
  `{comment: Chorus}\n[${chords[0]}]Hallelujah\n`
const IN_G = chart('G', ['G', 'C', 'D'])
const IN_A = chart('A', ['A', 'D', 'E'])
const IN_G_ARRANGED = chart('G', ['G', 'Em', 'D'])

describe('a chart, set apart from what is about the song', () => {
  it('knows the CCLI material SongSelect puts on its charts, and a chart without it', () => {
    expect(hasCcliBumph(`${IN_G}${BUMPH}`)).to.equal(true)
    expect(hasCcliBumph('{title: X}\n[G]x\nCCLI Song # 7102401\nsomething')).to.equal(true)
    expect(hasCcliBumph('{title: X}\n{ccli_license: 99}\n[G]x')).to.equal(true)
    expect(hasCcliBumph('{title: X}\nCCLI Licence No. 123')).to.equal(true)
    expect(hasCcliBumph(IN_G)).to.equal(false)
  })

  it('reads the key it says it is in', () => {
    expect(keyOfChart(IN_A)).to.equal('A')
    expect(keyOfChart('{title: X}\n[G]x')).to.equal(null)
  })

  it('is the same chart in another key, the same words and chords from the key', () => {
    expect(chartFingerprint(IN_A)).to.equal(chartFingerprint(IN_G))
  })

  it('does not care about the title, copyright, tempo or CCLI material, or the case and punctuation of the words', () => {
    const other = IN_G.replace('{title: Amazing}', '{title: Amazing (live)}')
      .replace('{tempo: 70}', '{tempo: 90}')
      .replace('2017 Somebody', 'Somebody else')
      .replace('Amazing [', 'AMAZING, [')
    expect(chartFingerprint(`${other}${BUMPH}\nCCLI Song # 1\ntrailer line`)).to.equal(
      chartFingerprint(IN_G)
    )
  })

  it('is another chart where the words, the chords or the sections differ', () => {
    const prints = new Set([
      chartFingerprint(IN_G),
      chartFingerprint(IN_G_ARRANGED),
      chartFingerprint(IN_G.replace('sweet\n', 'sweet the sound\n')),
      chartFingerprint(IN_G.replace('{comment: Chorus}', '{comment: Bridge}')),
    ])
    expect(prints.size).to.equal(4)
  })

  it('keeps a section directive that has no label, and the note after one', () => {
    const base = '{key: G}\n{start_of_chorus}\n[G]Hallelujah\n{end_of_chorus}\n'
    expect(chartFingerprint(base)).to.equal(chartFingerprint(`${base}`))
    expect(chartFingerprint(base)).to.not.equal(
      chartFingerprint(base.replace('{end_of_chorus}', ''))
    )
    expect(chartFingerprint('{comment: Chorus} (a cappella)\n[G]x')).to.not.equal(
      chartFingerprint('{comment: Chorus}\n[G]x')
    )
  })

  it('compares the chords as written when the chart names no key', () => {
    const noKey = (text: string) => text.replace('{key: G}\n', '').replace('{key: A}\n', '')
    expect(chartFingerprint(noKey(IN_G))).to.equal(chartFingerprint(noKey(IN_G)))
    expect(chartFingerprint(noKey(IN_G))).to.not.equal(chartFingerprint(noKey(IN_A)))
  })
})

const record = (overrides: Partial<SongRecord> = {}): SongRecord =>
  ({ ...makeSong(), tempo: null, originalTempo: null, ...overrides }) as SongRecord
const withText = (song: SongRecord, text: string): SongWithText => ({ song, text })

describe('which songs are the same song twice', () => {
  const june = record({
    uuid: 'june',
    id: 'ccli-1',
    ccliNumber: '1',
    title: 'Amazing',
    importDate: '2026-06-21',
  })
  const may = record({
    uuid: 'may',
    id: 'ccli-1',
    ccliNumber: '1',
    title: 'Amazing',
    importDate: '2026-05-04',
  })

  it('merges two records of one song with the same chart, keeping the one the setlists use', () => {
    const plan = planMerge([withText(may, IN_G), withText(june, IN_A)], new Map([['june', 3]]))
    expect(plan.distinct).to.deep.equal([])
    expect(plan.merges).to.have.length(1)
    expect(plan.merges[0].keep.uuid).to.equal('june')
    expect(plan.merges[0].remove.map(each => each.uuid)).to.deep.equal(['may'])
  })

  it('keeps the default rather than a variant, then the oldest, when the setlists use neither', () => {
    const variant = { ...may, isDefault: false, variantOf: 'june' }
    expect(
      planMerge([withText(variant, IN_G), withText(june, IN_G)], new Map()).merges[0].keep.uuid
    ).to.equal('june')
    expect(
      planMerge([withText(june, IN_G), withText(may, IN_G)], new Map()).merges[0].keep.uuid
    ).to.equal('may')
  })

  it('finds a song by title when it has no CCLI number', () => {
    const a = record({ uuid: 'a', id: 'title-hymn', title: 'Hymn', titleNormalized: 'hymn' })
    const b = record({ uuid: 'b', id: 'title-hymn', title: 'Hymn', titleNormalized: 'hymn' })
    expect(planMerge([withText(a, IN_G), withText(b, IN_G)], new Map()).merges).to.have.length(1)
  })

  it('leaves different arrangements of a song alone, and says there are several', () => {
    const plan = planMerge([withText(may, IN_G), withText(june, IN_G_ARRANGED)], new Map())
    expect(plan.merges).to.deep.equal([])
    expect(plan.distinct).to.deep.equal([{ identity: 'ccli 1', title: 'Amazing', arrangements: 2 }])
  })

  it('merges the repeats of each arrangement, and keeps the arrangements apart', () => {
    const third = { ...may, uuid: 'third' }
    const fourth = { ...may, uuid: 'fourth' }
    const plan = planMerge(
      [
        withText(may, IN_G),
        withText(june, IN_A),
        withText(third, IN_G_ARRANGED),
        withText(fourth, IN_G_ARRANGED),
      ],
      new Map()
    )
    expect(plan.merges).to.have.length(2)
    expect(plan.distinct[0].arrangements).to.equal(2)
  })

  it('does not merge songs that merely share a title and have no CCLI number, when their charts differ', () => {
    const a = record({
      uuid: 'a',
      id: 'title-untitled',
      title: 'Untitled',
      titleNormalized: 'untitled',
    })
    const b = record({
      uuid: 'b',
      id: 'title-untitled',
      title: 'Untitled',
      titleNormalized: 'untitled',
    })
    const plan = planMerge([withText(a, IN_G), withText(b, IN_G_ARRANGED)], new Map())
    expect(plan.merges).to.deep.equal([])
  })

  it('has nothing to merge in a library of single songs', () => {
    expect(planMerge([withText(june, IN_G)], new Map())).to.deep.equal({ merges: [], distinct: [] })
  })

  it('counts how often the setlists use each song', () => {
    const setlists = [
      makeSetlist({ songs: [makeEntry({ songUuid: 'a' }), makeEntry({ songUuid: 'a' })] }),
      makeSetlist({
        id: 's2',
        songs: [makeEntry({ songUuid: 'a' }), makeEntry({ songUuid: 'b' })],
      }),
      makeSetlist({ id: 's3', songs: [makeEntry({ songUuid: '' })] }),
    ]
    expect(usageOf(setlists)).to.deep.equal(
      new Map([
        ['a', 3],
        ['b', 1],
      ])
    )
  })
})

describe('what source a song should have', () => {
  const song = (overrides: Partial<SongRecord>) =>
    record({ uuid: crypto.randomUUID(), ...overrides })

  it('is SongSelect for a chart with the CCLI material, and the person who wrote the rest', () => {
    const changes = planSources(
      [
        withText(song({ title: 'From SongSelect', importSource: '' }), `${IN_G}${BUMPH}`),
        withText(song({ title: 'Typed in', importSource: '' }), IN_G),
      ],
      'Simon Davy'
    )
    expect(changes.map(change => [change.title, change.to, change.becauseCcli])).to.deep.equal([
      ['From SongSelect', 'songselect', true],
      ['Typed in', 'Simon Davy', false],
    ])
  })

  it('treats a source that only said how the song arrived as unknown, and leaves a real one alone', () => {
    const changes = planSources(
      [
        withText(song({ title: 'Drive', importSource: 'drive' }), IN_G),
        withText(song({ title: 'Real', importSource: 'file' }), IN_G),
        withText(song({ title: 'SongSelect', importSource: 'songselect' }), IN_G),
        withText(song({ title: 'None', importSource: undefined as unknown as string }), IN_G),
      ],
      'Simon Davy'
    )
    expect(changes.map(change => change.title)).to.deep.equal(['Drive', 'None'])
  })
})

describe('repairing a library', () => {
  let db: ChordlessDB
  let dbName: string

  beforeEach(async () => {
    dbName = `repair-${crypto.randomUUID()}`
    db = new ChordlessDB(dbName)
    await db.init()
  })

  afterEach(async () => {
    must(db.db).close()
    await deleteDatabase(dbName)
  })

  /** A song with its chart, as the app saves them */
  async function addSong(uuid: string, text: string, overrides: Partial<SongRecord> = {}) {
    await db.saveChordPro({
      id: `chordpro-${uuid}`,
      content: text,
      contentHash: hashText(text),
      lastModified: 1,
    })
    return db.saveSong({
      ...makeSong({
        uuid,
        id: 'ccli-1',
        ccliNumber: '1',
        title: 'Amazing',
        titleNormalized: 'amazing',
        chordproFileId: `chordpro-${uuid}`,
        key: keyOfChart(text),
        originalKey: keyOfChart(text),
        importSource: 'drive',
        ...overrides,
      }),
    })
  }

  /** A library of the duplicated song, and one setlist using each copy */
  async function duplicated() {
    await addSong('may', IN_G, { importDate: '2026-05-04T00:00:00Z', tempo: 70 })
    await addSong('june', `${IN_A}${BUMPH}`, { importDate: '2026-06-21T00:00:00Z', tempo: 70 })
    await db.saveSetlist(
      makeSetlist({
        id: 'uses-june',
        songs: [0, 1, 2].map(order =>
          makeEntry({ order, songUuid: 'june', songId: 'ccli-1', key: null })
        ),
      })
    )
    await db.saveSetlist(
      makeSetlist({
        id: 'uses-may',
        songs: [
          makeEntry({ order: 0, songUuid: 'may', songId: 'ccli-1', key: null, tempo: null }),
          makeEntry({ order: 1, songUuid: 'may', songId: 'ccli-1', key: 'F' }),
          makeEntry({ order: 2, songUuid: 'other', songId: 'title-other' }),
        ],
      })
    )
  }

  it('plans without changing anything', async () => {
    await duplicated()
    const plan = await planRepair(db, 'Simon Davy')
    expect(plan.songs).to.equal(2)
    expect(plan.setlists).to.equal(2)
    expect(
      plan.merges.map(group => [group.keep.uuid, group.remove.map(each => each.uuid)])
    ).to.deep.equal([['june', ['may']]])
    expect(Object.fromEntries(plan.sources.map(change => [change.uuid, change.to]))).to.deep.equal({
      may: 'Simon Davy',
      june: 'songselect',
    })
    expect((await db.getAllSongs()).map(song => song.importSource)).to.deep.equal([
      'drive',
      'drive',
    ])
    expect(await db.getAllSongs()).to.have.length(2)
  })

  it('sets the sources, merges the copies, and moves the setlist entries to the song kept', async () => {
    await duplicated()
    const report = await applyRepair(db, await planRepair(db, 'Simon Davy'))
    expect(report).to.deep.equal({
      sourcesSet: 2,
      songsRemoved: 1,
      setlistsChanged: 1,
      entriesMoved: 2,
    })

    expect((await db.getAllSongs()).map(song => song.uuid)).to.deep.equal(['june'])
    expect(must(await db.getSong('june')).importSource).to.equal('songselect')
    expect(await db.getChordPro('chordpro-may')).to.equal(undefined)

    const moved = must(await db.getSetlist('uses-may'))
    expect(moved.songs.map(entry => entry.songUuid)).to.deep.equal(['june', 'june', 'other'])
    // (the entry with no key of its own was shown in G, so it keeps showing G; the one that chose F keeps F;
    // the song kept is in A)
    expect(moved.songs.map(entry => entry.key)).to.deep.equal(['G', 'F', null])
    // (a song that is not in the library is not touched)
    expect(moved.songs[2].songUuid).to.equal('other')
    expect(moved.modifiedDate).to.not.equal('2026-10-11T10:00:00.000Z')
    expect(must(await db.getSetlist('uses-june')).modifiedDate).to.equal('2026-10-11T10:00:00.000Z')
  })

  it('keeps showing the tempo an entry showed', async () => {
    await addSong('may', IN_G, { tempo: 90 })
    await addSong('june', IN_G, { tempo: 70 })
    await db.saveSetlist(
      makeSetlist({
        songs: [
          makeEntry({ songUuid: 'june' }),
          makeEntry({ order: 1, songUuid: 'june' }),
          makeEntry({ order: 2, songUuid: 'may', tempo: null }),
          makeEntry({ order: 3, songUuid: 'may', tempo: 80 }),
        ],
      })
    )
    await applyRepair(db, await planRepair(db, 'Simon Davy'))
    const tempos = must(await db.getSetlist('setlist-1')).songs.map(entry => entry.tempo)
    expect(tempos).to.deep.equal([null, null, 90, 80])
  })

  it('notes the Drive file of a song removed, to go in the trash, and not one that never reached Drive', async () => {
    await duplicated()
    const may = must(await db.getSong('may'))
    await db.saveSong({ ...may, fileRef: 'drive-file-may' })
    await applyRepair(db, await planRepair(db, 'Simon Davy'))
    expect((await db.getPendingDeletions()).map(entry => entry.ref)).to.deep.equal([
      'drive-file-may',
    ])
  })

  it('marks the songs whose source was set as changed, for the next sync to send', async () => {
    await duplicated()
    await applyRepair(db, await planRepair(db, 'Simon Davy'))
    expect(must(await db.getSong('june')).metadataChangedAt).to.be.a('string')
  })

  it('leaves nothing to do the second time', async () => {
    await duplicated()
    await applyRepair(db, await planRepair(db, 'Simon Davy'))
    const again = await planRepair(db, 'Simon Davy')
    expect(again.merges).to.deep.equal([])
    expect(again.sources).to.deep.equal([])
    expect(await applyRepair(db, again)).to.deep.equal({
      sourcesSet: 0,
      songsRemoved: 0,
      setlistsChanged: 0,
      entriesMoved: 0,
    })
  })

  it('makes the song kept the default when the one removed was, and points the variants at it', async () => {
    await addSong('default', IN_G, { importDate: '2026-05-04T00:00:00Z', isDefault: true })
    await addSong('keeper', IN_A, {
      isDefault: false,
      variantOf: 'default',
      importDate: '2026-06-01T00:00:00Z',
    })
    await addSong('arrangement', IN_G_ARRANGED, {
      isDefault: false,
      variantOf: 'default',
      variantLabel: 'Simpler',
    })
    await db.saveSetlist(makeSetlist({ songs: [makeEntry({ songUuid: 'keeper' })] }))
    await applyRepair(db, await planRepair(db, 'Simon Davy'))
    const left = Object.fromEntries((await db.getAllSongs()).map(song => [song.uuid, song]))
    expect(Object.keys(left).sort()).to.deep.equal(['arrangement', 'keeper'])
    expect(left.keeper.isDefault).to.equal(true)
    expect(left.keeper.variantOf).to.equal(null)
    expect(left.arrangement.variantOf).to.equal('keeper')
    expect(left.arrangement.isDefault).to.equal(false)
  })

  it('skips a song in the plan that has been deleted since', async () => {
    await duplicated()
    const plan = await planRepair(db, 'Simon Davy')
    await db.deleteSong('may')
    const report = await applyRepair(db, plan)
    expect(report.sourcesSet).to.equal(1)
    expect((await db.getAllSongs()).map(song => song.uuid)).to.deep.equal(['june'])
  })

  it('does not touch a library with nothing the matter with it', async () => {
    await addSong('one', `${IN_G}${BUMPH}`, { importSource: 'songselect' })
    await db.saveSetlist(makeSetlist({ songs: [makeEntry({ songUuid: 'one' })] }))
    const plan = await planRepair(db, 'Simon Davy')
    expect(plan.merges).to.deep.equal([])
    expect(plan.sources).to.deep.equal([])
    expect(await applyRepair(db, plan)).to.deep.equal({
      sourcesSet: 0,
      songsRemoved: 0,
      setlistsChanged: 0,
      entriesMoved: 0,
    })
  })

  it('plans for a song whose chart is missing as one with no words, rather than failing', async () => {
    await db.saveSong(makeSong({ uuid: 'no-chart', chordproFileId: 'missing', importSource: '' }))
    const plan = await planRepair(db, 'Simon Davy')
    expect(plan.sources.map(change => [change.uuid, change.to])).to.deep.equal([
      ['no-chart', 'Simon Davy'],
    ])
  })
})
