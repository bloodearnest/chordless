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
  type ChartComparison,
  chartFingerprint,
  compareCharts,
  hasCcliBumph,
  keyOfChart,
  planImporters,
  planLinks,
  planMerge,
  planRepair,
  planSources,
  type SongWithText,
  usageOf,
  wordSimilarity,
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

describe('comparing two charts', () => {
  const verdict = (a: string, b: string) => compareCharts(a, b).verdict

  it('says identical, the same chart with other details, another key, other chords, other words', () => {
    expect(verdict(IN_G, IN_G)).to.equal('identical')
    expect(verdict(IN_G, IN_G.replace('2017 Somebody', 'Other'))).to.equal('same-chart')
    expect(verdict(IN_G, IN_A)).to.equal('other-key')
    expect(verdict(IN_G, IN_G_ARRANGED)).to.equal('different-chords')
    expect(verdict(IN_G, IN_G.replace('Hallelujah', 'Glory'))).to.equal('different-words')
  })

  it('gives the two keys', () => {
    expect(compareCharts(IN_G, IN_A).keys).to.deep.equal(['G', 'A'])
  })

  const marks = (side: ChartComparison['stanzas'][0]) =>
    side.map(stanza => [stanza.heading, stanza.status])

  it('marks no stanza for a change of key', () => {
    const { stanzas } = compareCharts(IN_G, IN_A)
    expect(marks(stanzas[0])).to.deep.equal([
      ['Verse 1', 'same'],
      ['Chorus', 'same'],
    ])
    expect(marks(stanzas[1])).to.deep.equal(marks(stanzas[0]))
    expect(stanzas[0][0].lines[0]).to.contain('[G]Amazing')
    expect(stanzas[1][0].lines[0]).to.contain('[A]Amazing')
  })

  it('marks the stanza whose chords differ, and only that, in both charts', () => {
    const { stanzas } = compareCharts(IN_G, IN_G_ARRANGED)
    const expected = [
      ['Verse 1', 'chords'],
      ['Chorus', 'same'],
    ]
    expect(marks(stanzas[0])).to.deep.equal(expected)
    expect(marks(stanzas[1])).to.deep.equal(expected)
  })

  it('marks a stanza with other words, and a stanza only one chart has', () => {
    const extra = IN_G.replace(
      '{comment: Chorus}',
      '{comment: Bridge}\n[A]New line\n{comment: Chorus}'
    )
    const { stanzas } = compareCharts(IN_G, extra)
    expect(marks(stanzas[0])).to.deep.equal([
      ['Verse 1', 'same'],
      ['Chorus', 'same'],
    ])
    expect(marks(stanzas[1])).to.deep.equal([
      ['Verse 1', 'same'],
      ['Bridge', 'only'],
      ['Chorus', 'same'],
    ])
    const long = IN_G.replace('Hallelujah', 'Hallelujah praise the Lord')
    const reworded = compareCharts(long, long.replace('Lord', 'King'))
    expect(reworded.stanzas[0][1].status).to.equal('words')
    expect(reworded.stanzas[0][1].matched).to.equal('Chorus')
  })

  it('pairs a repeated or moved stanza with its closest, not by position', () => {
    const swapped = `{title: Amazing}\n{key: G}\n{comment: Chorus}\n[G]Hallelujah\n{comment: Verse 1}\n[G]Amazing [C]grace how [D]sweet\n`
    expect(marks(compareCharts(IN_G, swapped).stanzas[0])).to.deep.equal([
      ['Verse 1', 'same'],
      ['Chorus', 'same'],
    ])
  })

  it('compares charts with nothing in them', () => {
    expect(compareCharts('', '').stanzas).to.deep.equal([[], []])
    expect(verdict('', IN_G)).to.equal('different-words')
  })
})

describe('the words of two charts', () => {
  const lines = (...parts: string[]) => `{title: Alone}\n{key: E}\n${parts.join('\n')}`
  const LIBRARY = lines(
    '{comment: Verse 1}',
    'In Christ a[C#m7]lone my hope is',
    '[G#m7]found, He is my [Amaj7]light my strength my song',
    'This Corner[C#m7]stone this solid [G#m7]Ground, firm through the [Amaj7]fiercest drought and storm'
  )
  const OFFICIAL = lines(
    '{comment: Verse 1}',
    'In [4]Christ a -',
    '[1]lone my [4]hope is',
    '[5]found',
    '[1/3]He is my [4]light, [1/3]my [2m7]strength, [4/5]my [1]song',
    'This [4]Corner -',
    '[1]stone, this [4]solid [5]Ground',
    '[1/3]Firm through the [4]fierc - [1/3]est [2m7]drought [4/5]and [1]storm'
  )

  it('are the same whatever the line breaks, hyphens, punctuation and case', () => {
    expect(wordSimilarity(LIBRARY, OFFICIAL)).to.equal(1)
    expect(compareCharts(LIBRARY, OFFICIAL).verdict).to.equal('different-chords')
  })

  it('forgive a typo, and tell different words', () => {
    const typo = LIBRARY.replace('fiercest', 'fiercset').replace('Ground', 'Grund')
    expect(wordSimilarity(typo, LIBRARY)).to.be.greaterThan(0.95)
    expect(compareCharts(typo, LIBRARY).verdict).to.equal('same-chart')
    const other = lines('Something else entirely, not at all the same song to sing')
    expect(wordSimilarity(other, LIBRARY)).to.be.lessThan(0.3)
    expect(compareCharts(other, LIBRARY).verdict).to.equal('different-words')
  })

  it('compare the chords in order, whatever the lines, so a layout change in another key is the same chart', () => {
    const broken = IN_A.replace('grace how [E]sweet', 'grace\nhow [E]sweet')
    expect(compareCharts(IN_G, broken).verdict).to.equal('other-key')
  })

  it('are matched stanza by stanza, however the lines break: the verse has other chords, nothing else', () => {
    const { stanzas } = compareCharts(LIBRARY, OFFICIAL)
    expect(stanzas[0].map(stanza => [stanza.heading, stanza.status])).to.deep.equal([
      ['Verse 1', 'chords'],
    ])
    expect(stanzas[0][0].similarity).to.equal(1)
  })
})

describe('songs to fold into another', () => {
  const song = (uuid: string, id: string, title: string, ccli: string | null = null) =>
    withText(
      record({
        uuid,
        id,
        title,
        titleNormalized: title.toLowerCase(),
        ccliNumber: ccli,
      }),
      IN_G
    )

  it("are the songs with no CCLI number whose title is a CCLI song's", () => {
    expect(
      planLinks([
        song('hand', 'title-in christ alone', 'In Christ Alone'),
        song('official', 'ccli-3350395', 'In Christ Alone', '3350395'),
        song('other', 'title-other', 'Other'),
      ])
    ).to.deep.equal([
      { fromId: 'title-in christ alone', intoId: 'ccli-3350395', title: 'In Christ Alone' },
    ])
  })

  it("leave alone a title that is several CCLI songs's, and a song with a CCLI number", () => {
    expect(
      planLinks([
        song('hand', 'title-holy', 'Holy'),
        song('a', 'ccli-1', 'Holy', '1'),
        song('b', 'ccli-2', 'Holy', '2'),
      ])
    ).to.deep.equal([])
    expect(planLinks([song('a', 'ccli-1', 'Holy', '1')])).to.deep.equal([])
  })

  it('count each song once, however many variants it has, and are in title order', () => {
    const links = planLinks([
      song('z1', 'title-zeal', 'Zeal'),
      song('z2', 'title-zeal', 'Zeal'),
      song('a1', 'title-amen', 'Amen'),
      song('zc', 'ccli-9', 'Zeal', '9'),
      song('ac', 'ccli-8', 'Amen', '8'),
    ])
    expect(links.map(link => link.title)).to.deep.equal(['Amen', 'Zeal'])
  })
})

describe('the stanzas of a chart', () => {
  it('begin at a comment or a start_of_ directive, and end_of_ ones are not stanzas or lines', () => {
    const text = `{title: X}\n[G]Before any heading\n{start_of_verse: Verse 1}\n[G]In the verse\n{end_of_verse}\n{soc}\n[G]In the chorus\n{eoc}\n{comment}\n[G]Untitled`
    const { stanzas } = compareCharts(text, text)
    expect(stanzas[0].map(stanza => stanza.heading)).to.deep.equal([
      '',
      'Verse 1',
      '{soc}',
      '{comment}',
    ])
    expect(stanzas[0][1].lines).to.deep.equal(['[G]In the verse'])
  })

  it('match by chords when they have no words, by heading when the chords differ, and not otherwise', () => {
    const a = '{comment: Instrumental}\n[G] [C] [D]'
    const same = compareCharts(a, '{comment: Instrumental}\n[G] [C] [D]')
    expect(same.stanzas[0][0].status).to.equal('same')
    const other = compareCharts(a, '{comment: Instrumental}\n[G] [Em] [D]')
    expect(other.stanzas[0][0].status).to.equal('chords')
    const renamed = compareCharts(a, '{comment: Outro}\n[G] [Em] [D]')
    expect(renamed.stanzas[0][0].status).to.equal('only')
  })

  it('leave the CCLI trailer out of the words', () => {
    const trailer = '\nCCLI Song # 7000001\nFor use solely with the SongSelect Terms of Use.'
    expect(wordSimilarity('[G]amazing grace', `[G]amazing grace${trailer}`)).to.equal(1)
  })

  it('treat a word one typo away as the same word, and a short word as different', () => {
    expect(wordSimilarity('[G]grace is amazing', '[G]grace is amazng')).to.equal(1)
    expect(wordSimilarity('[G]grace is amazing', '[G]grace is amazzing')).to.equal(1)
    expect(wordSimilarity('[G]grace is amazing', '[G]grace is amazang')).to.equal(1)
    expect(wordSimilarity('[G]grace is the way', '[G]grace is the war')).to.be.lessThan(1)
    expect(wordSimilarity('[G]amazing grace', '[G]amazing graces')).to.equal(1)
    expect(wordSimilarity('[G]amazing grace', '[G]amazing gracefully')).to.be.lessThan(1)
    expect(wordSimilarity('[G]one two three', '')).to.equal(0)
  })
})

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
      songsLinked: 0,
      importersSet: 2,
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

  it('reports the songs it would merge but does not merge them when told not to', async () => {
    await duplicated()
    const plan = await planRepair(db, 'Simon Davy', { merge: false })
    expect(plan.merging).to.equal(false)
    expect(plan.merges).to.deep.equal([])
    expect(plan.sources.length).to.be.greaterThan(0)
    const report = await applyRepair(db, plan)
    expect(report.songsRemoved).to.equal(0)
    expect(await db.getAllSongs()).to.have.length(2)
    expect((await planRepair(db, 'Simon Davy')).merging).to.equal(true)
  })

  it('will not plan with no name to give the songs', async () => {
    await duplicated()
    let failure = ''
    await planRepair(db, '  ').catch(error => {
      failure = error.message
    })
    expect(failure).to.contain('blank')
  })

  it('folds a song with no CCLI number into the CCLI song of its title, as a variant', async () => {
    await addSong('official', IN_G, { importUser: 'Jo', importSource: 'songselect' })
    await addSong('hand', `${IN_G}x`, {
      id: 'title-amazing',
      ccliNumber: null,
      titleNormalized: 'amazing',
      isDefault: true,
      importUser: 'Jo',
      importSource: 'songselect',
    })
    const plan = await planRepair(db, 'Simon Davy')
    expect(plan.links.map(link => [link.fromId, link.intoId])).to.deep.equal([
      ['title-amazing', 'ccli-1'],
    ])
    const report = await applyRepair(db, plan)
    expect(report.songsLinked).to.equal(1)
    expect(must(await db.getSong('hand')).id).to.equal('ccli-1')
    expect(must(await db.getSong('hand')).variantOf).to.equal('official')
    expect((await planRepair(db, 'Simon Davy')).links).to.deep.equal([])
  })

  it('skips a link whose song has gone since the plan', async () => {
    await addSong('official', IN_G, { importUser: 'Jo', importSource: 'songselect' })
    await addSong('hand', IN_G, {
      id: 'title-amazing',
      ccliNumber: null,
      titleNormalized: 'amazing',
      importUser: 'Jo',
      importSource: 'songselect',
    })
    const plan = await planRepair(db, 'Simon Davy')
    await db.deleteSong('hand')
    expect((await applyRepair(db, plan)).songsLinked).to.equal(0)
  })

  it('leaves nothing to do the second time', async () => {
    await duplicated()
    await applyRepair(db, await planRepair(db, 'Simon Davy'))
    const again = await planRepair(db, 'Simon Davy')
    expect(again.merges).to.deep.equal([])
    expect(again.sources).to.deep.equal([])
    expect(await applyRepair(db, again)).to.deep.equal({
      songsLinked: 0,
      importersSet: 0,
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

  it('gives the songs with no importer the owner, and leaves a song that has one', async () => {
    const apart = (id: string) => ({ id: `title-${id}`, titleNormalized: id, ccliNumber: null })
    await addSong('old', IN_G, { importUser: 'default-user', ...apart('one') })
    await addSong('blank', IN_A, { importUser: null, ...apart('two') })
    await addSong('known', IN_A, { importUser: 'Jo', ...apart('three') })
    const plan = await planRepair(db, 'Simon Davy')
    expect(plan.importers.map(change => change.uuid).sort()).to.deep.equal(['blank', 'old'])
    expect(planImporters([])).to.deep.equal([])

    const report = await applyRepair(db, plan)
    expect(report.importersSet).to.equal(2)
    const users = Object.fromEntries((await db.getAllSongs()).map(s => [s.uuid, s.importUser]))
    expect(users).to.deep.equal({ old: 'Simon Davy', blank: 'Simon Davy', known: 'Jo' })
    expect(must(await db.getSong('old')).metadataChangedAt).to.be.a('string')
    expect((await planRepair(db, 'Simon Davy')).importers).to.deep.equal([])
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
    await addSong('one', `${IN_G}${BUMPH}`, { importSource: 'songselect', importUser: 'Jo' })
    await db.saveSetlist(makeSetlist({ songs: [makeEntry({ songUuid: 'one' })] }))
    const plan = await planRepair(db, 'Simon Davy')
    expect(plan.merges).to.deep.equal([])
    expect(plan.sources).to.deep.equal([])
    expect(await applyRepair(db, plan)).to.deep.equal({
      songsLinked: 0,
      importersSet: 0,
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
