import { expect } from '@open-wc/testing'
import { getCurrentDB } from '../public/js/db.js'
import { ChordProParser } from '../public/js/parser.js'
import { buildRuntimeSongs, parseTempoMetadata } from '../public/js/setlist/runtime-songs.js'
import { suppressConsoleLogs } from './test-helpers.js'

const { describe, it, before } = window

describe('parseTempoMetadata', () => {
  it('reads a number, or a number as text', () => {
    expect(parseTempoMetadata(120)).to.deep.equal({ bpm: 120, tempoNote: null })
    expect(parseTempoMetadata('96')).to.deep.equal({ bpm: 96, tempoNote: null })
    expect(parseTempoMetadata('72.5')).to.deep.equal({ bpm: 72.5, tempoNote: null })
  })

  it('reads the note value in brackets', () => {
    expect(parseTempoMetadata('60 (1/8)')).to.deep.equal({ bpm: 60, tempoNote: '1/8' })
    expect(parseTempoMetadata(' 80( 1/2 ) ')).to.deep.equal({ bpm: 80, tempoNote: '1/2' })
  })

  it('has nothing for no tempo, or text with no number', () => {
    for (const raw of [undefined, null, '', 'fast']) {
      expect(parseTempoMetadata(raw), String(raw)).to.deep.equal({ bpm: null, tempoNote: null })
    }
  })
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
  async function addSong(chart, { tempo } = {}) {
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

  const build = songs => buildRuntimeSongs({ songs }, { db, parser, fontSize: 1.6 })
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

  describe('tempo', () => {
    it("takes the setlist's tempo over the chart's", async () => {
      const songId = await addSong(chart('{tempo: 72}'))
      const [song] = await build([{ songId, tempo: 90, order: 0 }])
      expect(song.currentBPM).to.equal(90)
      expect(song.metadata.tempo).to.equal(90)
    })

    it("uses the chart's tempo when the setlist has none", async () => {
      const songId = await addSong(chart('{tempo: 72}'))
      const [song] = await build([{ songId, order: 0 }])
      expect(song.currentBPM).to.equal(72)
    })

    it('has no BPM when neither has a tempo', async () => {
      const songId = await addSong(chart())
      const [song] = await build([{ songId, order: 0 }])
      expect(song.currentBPM).to.equal(null)
    })
  })

  describe('the note the tempo counts', () => {
    it('is quarter notes by default', async () => {
      const songId = await addSong(chart('{tempo: 80}'))
      const [song] = await build([{ songId, order: 0 }])
      expect(song.metadata.tempoNote).to.equal('1/4')
    })

    it('follows the time signature: 6/8 counts in eighths', async () => {
      const songId = await addSong(chart('{tempo: 100}\n{time: 6/8}'))
      const [song] = await build([{ songId, order: 0 }])
      expect(song.metadata.timeSignature).to.equal('6/8')
      expect(song.metadata.tempoNote).to.equal('1/8')
    })

    it('keeps a note written with the tempo', async () => {
      const songId = await addSong(chart('{tempo: 60 (1/2)}'))
      const [song] = await build([{ songId, order: 0 }])
      expect(song.currentBPM).to.equal(60)
      expect(song.metadata.tempoNote).to.equal('1/2')
    })
  })

  it('keeps the setlist entry, and the library song, for the models', async () => {
    const songId = await addSong(chart())
    const entry = { songId, order: 0 }
    const [song] = await build([entry])
    expect(song._setlistEntry).to.equal(entry)
    expect(song._canonicalSong.id).to.equal(songId)
  })
})
