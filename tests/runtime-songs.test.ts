import { expect } from '@open-wc/testing'
import type { SetlistEntry, TempoInput } from '../src/js/data-types.ts'
import { getCurrentDB } from '../src/js/db.ts'
import { ChordProParser } from '../src/js/parser.ts'
import { buildRuntimeSongs, parseTempoMetadata } from '../src/js/setlist/runtime-songs.ts'
import { makeEntry, makeSetlist } from './builders.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, before } = window

describe('parseTempoMetadata', () => {
  const cases: [TempoInput, { bpm: number | null; tempoNote: string | null }][] = [
    [120, { bpm: 120, tempoNote: null }],
    ['96', { bpm: 96, tempoNote: null }],
    ['72.5', { bpm: 72.5, tempoNote: null }],
    ['60 (1/8)', { bpm: 60, tempoNote: '1/8' }],
    [' 80( 1/2 ) ', { bpm: 80, tempoNote: '1/2' }],
    [undefined, { bpm: null, tempoNote: null }],
    [null, { bpm: null, tempoNote: null }],
    ['', { bpm: null, tempoNote: null }],
    ['fast', { bpm: null, tempoNote: null }],
  ]
  for (const [raw, expected] of cases) {
    it(`${JSON.stringify(raw) ?? 'undefined'} is ${JSON.stringify(expected)}`, () => {
      expect(parseTempoMetadata(raw)).to.deep.equal(expected)
    })
  }
})

describe('buildRuntimeSongs', () => {
  let db
  let parser

  suppressConsoleLogs()

  before(async () => {
    db = await getCurrentDB()
    parser = new ChordProParser()
  })

  /** Save a library song with the chart given, and return its id */
  async function addSong(chart, { tempo }: { tempo?: TempoInput } = {}) {
    const unique = crypto.randomUUID()
    await db.saveChordPro({
      id: `chordpro-${unique}`,
      content: chart,
      contentHash: unique,
      lastModified: Date.now(),
    })
    await db.saveSong({
      uuid: `song-${unique}`,
      id: `title-${unique}`,
      title: 'A song',
      titleNormalized: unique,
      tempo,
      isDefault: true,
      chordproFileId: `chordpro-${unique}`,
      modifiedDate: new Date().toISOString(),
    })
    return `title-${unique}`
  }

  const build = (entries: Partial<SetlistEntry>[]) =>
    buildRuntimeSongs(makeSetlist({ songs: entries.map(entry => makeEntry(entry)) }), {
      db,
      parser,
      fontSize: 1.6,
    })
  const chart = (extra = '') =>
    `{title: Grace}\n{key: G}\n${extra}\n\n{comment: Verse 1}\n[G]Amazing [C]grace`

  it('parses the library song, in its own key when the setlist gives none', async () => {
    const songId = await addSong(chart())
    const [song] = await build([{ songId, order: 0 }])
    expect(song.title).to.equal('Grace')
    expect(song.originalKey).to.equal('G')
    expect(song.currentKey).to.equal('G')
    expect(song.songId).to.equal(songId)
    expect(song.songIndex).to.equal(0)
    expect(song.currentFontSize).to.equal(1.6)
    expect(song.currentCapo).to.equal(0)
    expect(song.hasLocalEdits).to.equal(false)
  })

  it("transposes to the setlist's key, keeping the original", async () => {
    const songId = await addSong(chart())
    const [song] = await build([{ songId, key: 'A', order: 0 }])
    expect(song.originalKey).to.equal('G')
    expect(song.currentKey).to.equal('A')
    expect(song.parsed.metadata.key).to.equal('A')
    expect(song.metadata.key).to.equal('A')
    // [G]Amazing [C]grace, up a tone
    const chords = JSON.stringify(song.parsed)
    expect(chords).to.include('"A"')
    expect(chords).to.include('"D"')
  })

  it("uses the setlist's own edited chart, without looking the song up", async () => {
    const edited = '{title: Edited}\n{key: D}\n\n[D]Edited words'
    const [song] = await build([
      { songId: 'title-not-in-the-library', chordproEdits: edited, order: 2 },
    ])
    expect(song.title).to.equal('Edited')
    expect(song.sourceText).to.equal(edited)
    expect(song.hasLocalEdits).to.equal(true)
    expect(song.originalKey).to.equal('D')
    expect(song.songIndex).to.equal(2)
  })

  it('leaves out a song that is not in the library, and goes on with the rest', async () => {
    const songId = await addSong(chart())
    const songs = await build([
      { songId: 'title-gone-missing', order: 0 },
      { songId, order: 1 },
    ])
    expect(songs).to.have.length(1)
    expect(songs[0].songId).to.equal(songId)
  })

  it('names a song with no title after its place in the setlist', async () => {
    const [song] = await build([
      { songId: 'title-x', chordproEdits: '{key: C}\n\n[C]Words', order: 3 },
    ])
    expect(song.title).to.equal('Song 4')
  })

  describe('tempo, and the note it counts', () => {
    // [what happens, the chart's extra lines, the setlist's tempo, what the song gets]
    const cases: [
      string,
      string,
      number | undefined,
      { bpm: number | null; note: string; time?: string },
    ][] = [
      ["the setlist's tempo wins over the chart's", '{tempo: 72}', 90, { bpm: 90, note: '1/4' }],
      [
        "the chart's tempo is used when the setlist has none",
        '{tempo: 72}',
        undefined,
        { bpm: 72, note: '1/4' },
      ],
      ['there is no BPM when neither has a tempo', '', undefined, { bpm: null, note: '1/4' }],
      [
        '6/8 counts in eighths',
        '{tempo: 100}\n{time: 6/8}',
        undefined,
        { bpm: 100, note: '1/8', time: '6/8' },
      ],
      [
        'a note written with the tempo is kept',
        '{tempo: 60 (1/2)}',
        undefined,
        { bpm: 60, note: '1/2' },
      ],
    ]
    for (const [what, extra, tempo, expected] of cases) {
      it(what, async () => {
        const songId = await addSong(chart(extra))
        const [song] = await build([{ songId, tempo, order: 0 }])
        expect(song.currentBPM).to.equal(expected.bpm)
        expect(song.metadata.tempo).to.equal(expected.bpm)
        expect(song.metadata.tempoNote).to.equal(expected.note)
        if (expected.time) expect(song.metadata.timeSignature).to.equal(expected.time)
      })
    }
  })

  it('keeps the setlist entry, and the library song, for the models', async () => {
    const songId = await addSong(chart())
    const entry = makeEntry({ songId })
    const [song] = await buildRuntimeSongs(makeSetlist({ songs: [entry] }), {
      db,
      parser,
      fontSize: 1.6,
    })
    expect(song._setlistEntry).to.equal(entry)
    expect(must(song._canonicalSong).id).to.equal(songId)
  })
})
