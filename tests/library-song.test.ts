import { expect } from '@open-wc/testing'
import type { LoadedSong } from '../src/js/data-types.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { LibrarySong } from '../src/js/models/library-song.ts'
import { ChordProParser } from '../src/js/parser.ts'
import { getSongUserPrefs, saveSongUserPrefs } from '../src/js/song-user-prefs.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs, uniqueName } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const clearLocalStorage = orgId => {
  localStorage.removeItem(`song-prefs-${orgId}`)
}

const sampleChordPro = `{title: Amazing Grace}
{artist: John Newton}
{key: G}
{tempo: 90}
{time: 3/4}

[Verse 1]
Amazing [G]grace, how [C]sweet the [G]sound
That saved a [Em]wretch like [D]me

[Chorus]
How [G]precious did that [C]grace ap[G]pear
The [Em]hour I [D]first be[G]lieved`

describe('LibrarySong', () => {
  let db
  let orgId
  let song
  let parser

  beforeEach(async () => {
    orgId = `test-org-${uniqueName()}`
    db = new ChordlessDB(orgId)
    await db.init()
    parser = new ChordProParser()
    clearLocalStorage(orgId)
  })

  afterEach(async () => {
    if (db?.dbName) {
      await deleteDatabase(db.dbName)
      db = null
    }
    if (orgId) {
      clearLocalStorage(orgId)
    }
  })

  describe('Core Properties', () => {
    beforeEach(async () => {
      // Create a song in the database
      const _parsed = parser.parse(sampleChordPro)
      const chordproFileId = `chordpro-${uniqueName()}`

      await db.saveChordPro({
        id: chordproFileId,
        content: sampleChordPro,
        contentHash: 'hash-123',
        createdDate: new Date().toISOString(),
        modifiedDate: new Date().toISOString(),
      })

      const songData = {
        uuid: uniqueName(),
        id: 'ccli-12345',
        variantOf: null,
        isDefault: true,
        variantLabel: 'Original',
        chordproFileId: chordproFileId,
        ccliNumber: '12345',
        title: 'Amazing Grace',
        titleNormalized: 'amazing-grace',
        author: 'John Newton',
        copyright: null,
        key: 'G',
        originalKey: 'G',
        tempo: 90,
        originalTempo: 90,
        time: '3/4',
        importDate: new Date().toISOString(),
        importUser: 'test-user',
        importSource: 'test',
        sourceUrl: null,
        modifiedDate: new Date().toISOString(),
        driveFileId: null,
        driveModifiedTime: null,
        lastSyncedAt: null,
        contentHash: 'hash-123',
      }

      await db.saveSong(songData)

      // Get full song with content
      const fullSong = await db.getSong(songData.uuid)
      const chordpro = await db.getChordPro(fullSong.chordproFileId)
      const parsedContent = parser.parse(chordpro.content)

      song = new LibrarySong(
        {
          ...fullSong,
          parsed: parsedContent,
        },
        db,
        orgId
      )
    })

    it('returns correct id', () => {
      expect(song.id).to.equal('ccli-12345')
    })

    it('returns correct uuid', () => {
      expect(song.uuid).to.be.a('string')
      expect(song.uuid).to.have.length.greaterThan(0)
    })

    it('returns correct title', () => {
      expect(song.title).to.equal('Amazing Grace')
    })

    it('returns correct artist', () => {
      expect(song.artist).to.equal('John Newton')
    })

    it('returns parsed data', () => {
      expect(song.parsed).to.be.an('object')
      expect(song.parsed.sections).to.be.an('array')
      expect(song.parsed.sections.length).to.be.greaterThan(0)
    })
  })

  describe('Key and Tempo', () => {
    beforeEach(async () => {
      const _parsed = parser.parse(sampleChordPro)
      const chordproFileId = `chordpro-${uniqueName()}`

      await db.saveChordPro({
        id: chordproFileId,
        content: sampleChordPro,
        contentHash: 'hash-123',
        createdDate: new Date().toISOString(),
        modifiedDate: new Date().toISOString(),
      })

      const songData = {
        uuid: uniqueName(),
        id: 'ccli-12345',
        variantOf: null,
        isDefault: true,
        variantLabel: 'Original',
        chordproFileId: chordproFileId,
        ccliNumber: '12345',
        title: 'Amazing Grace',
        titleNormalized: 'amazing-grace',
        author: 'John Newton',
        key: 'G',
        originalKey: 'G',
        tempo: 90,
        originalTempo: 90,
        importDate: new Date().toISOString(),
        importUser: 'test-user',
        importSource: 'test',
        modifiedDate: new Date().toISOString(),
        contentHash: 'hash-123',
      }

      await db.saveSong(songData)

      const fullSong = await db.getSong(songData.uuid)
      const chordpro = await db.getChordPro(fullSong.chordproFileId)
      const parsedContent = parser.parse(chordpro.content)

      song = new LibrarySong(
        {
          ...fullSong,
          parsed: parsedContent,
        },
        db,
        orgId
      )
    })

    it('returns current key', () => {
      expect(song.getKey()).to.equal('G')
    })

    it('allows setting key', () => {
      song.setKey('A')
      expect(song.getKey()).to.equal('A')
    })

    it('persists key changes to database', async () => {
      song.setKey('A')
      await song.save()

      const loaded = await db.getSong(song.uuid)
      expect(loaded.key).to.equal('A')
    })

    it('returns original key', () => {
      expect(song.getOriginalKey()).to.equal('G')
    })

    it('preserves original key after changes', () => {
      song.setKey('A')
      expect(song.getOriginalKey()).to.equal('G')
    })

    it('returns current tempo', () => {
      expect(song.getTempo()).to.equal(90)
    })

    it('allows setting tempo', () => {
      song.setTempo(120)
      expect(song.getTempo()).to.equal(120)
    })

    it('persists tempo changes to database', async () => {
      song.setTempo(120)
      await song.save()

      const loaded = await db.getSong(song.uuid)
      expect(loaded.tempo).to.equal(120)
    })

    it('resets key to original', async () => {
      song.setKey('A')
      await song.reset()
      expect(song.getKey()).to.equal('G')
    })

    it('resets tempo to original', async () => {
      song.setTempo(120)
      await song.reset()
      expect(song.getTempo()).to.equal(90)
    })
  })

  describe('Capo (from song-user-prefs)', () => {
    beforeEach(async () => {
      const _parsed = parser.parse(sampleChordPro)
      const chordproFileId = `chordpro-${uniqueName()}`

      await db.saveChordPro({
        id: chordproFileId,
        content: sampleChordPro,
        contentHash: 'hash-123',
        createdDate: new Date().toISOString(),
        modifiedDate: new Date().toISOString(),
      })

      const songData = {
        uuid: uniqueName(),
        id: 'ccli-12345',
        chordproFileId: chordproFileId,
        title: 'Amazing Grace',
        key: 'G',
        originalKey: 'G',
        importDate: new Date().toISOString(),
        modifiedDate: new Date().toISOString(),
      }

      await db.saveSong(songData)

      const fullSong = await db.getSong(songData.uuid)
      const chordpro = await db.getChordPro(fullSong.chordproFileId)
      const parsedContent = parser.parse(chordpro.content)

      song = new LibrarySong(
        {
          ...fullSong,
          parsed: parsedContent,
        },
        db,
        orgId
      )
    })

    it('returns 0 when no capo is set', () => {
      expect(song.getCapo()).to.equal(0)
    })

    it('allows setting capo', () => {
      song.setCapo(2)
      expect(song.getCapo()).to.equal(2)
    })

    it('persists capo to song-user-prefs localStorage', async () => {
      song.setCapo(2)
      await song.save()

      const key = `song-prefs-${orgId}`
      const prefs = JSON.parse(must(localStorage.getItem(key)))
      expect(prefs['ccli-12345'].capo).to.equal(2)
    })

    it('loads capo from song-user-prefs', async () => {
      // Save capo preference
      const key = `song-prefs-${orgId}`
      localStorage.setItem(
        key,
        JSON.stringify({
          'ccli-12345': { capo: 3 },
        })
      )

      // Create new instance
      const fullSong = await db.getSong(song.uuid)
      const chordpro = await db.getChordPro(fullSong.chordproFileId)
      const parsedContent = parser.parse(chordpro.content)

      const song2 = new LibrarySong(
        {
          ...fullSong,
          parsed: parsedContent,
        },
        db,
        orgId
      )

      expect(song2.getCapo()).to.equal(3)
    })
  })

  describe('Section State (from song-user-prefs)', () => {
    beforeEach(async () => {
      const _parsed = parser.parse(sampleChordPro)
      const chordproFileId = `chordpro-${uniqueName()}`

      await db.saveChordPro({
        id: chordproFileId,
        content: sampleChordPro,
        contentHash: 'hash-123',
        createdDate: new Date().toISOString(),
        modifiedDate: new Date().toISOString(),
      })

      const songData = {
        uuid: uniqueName(),
        id: 'ccli-12345',
        chordproFileId: chordproFileId,
        title: 'Amazing Grace',
        key: 'G',
        importDate: new Date().toISOString(),
        modifiedDate: new Date().toISOString(),
      }

      await db.saveSong(songData)

      const fullSong = await db.getSong(songData.uuid)
      const chordpro = await db.getChordPro(fullSong.chordproFileId)
      const parsedContent = parser.parse(chordpro.content)

      song = new LibrarySong(
        {
          ...fullSong,
          parsed: parsedContent,
        },
        db,
        orgId
      )
    })

    it('returns default section state when no prefs exist', () => {
      const state = song.getSectionState(0)
      expect(state.hideMode).to.equal('none')
      expect(state.isCollapsed).to.equal(false)
      expect(state.isHidden).to.equal(false)
    })

    it('allows setting section state', () => {
      song.setSectionState(0, { hideMode: 'chords', isCollapsed: false, isHidden: false })
      const state = song.getSectionState(0)
      expect(state.hideMode).to.equal('chords')
    })

    it('persists section state to song-user-prefs', async () => {
      song.setSectionState(0, { hideMode: 'chords', isCollapsed: false, isHidden: false })
      song.setSectionState(1, { hideMode: 'none', isCollapsed: true, isHidden: false })
      await song.save()

      const key = `song-prefs-${orgId}`
      const prefs = JSON.parse(must(localStorage.getItem(key)))
      expect(prefs['ccli-12345'].sectionDefaults['0'].hideMode).to.equal('chords')
      expect(prefs['ccli-12345'].sectionDefaults['1'].isCollapsed).to.equal(true)
    })

    it('loads section state from song-user-prefs', async () => {
      // Save section preferences
      const key = `song-prefs-${orgId}`
      localStorage.setItem(
        key,
        JSON.stringify({
          'ccli-12345': {
            sectionDefaults: {
              0: { hideMode: 'lyrics', isCollapsed: false, isHidden: false },
              1: { hideMode: 'none', isCollapsed: true, isHidden: false },
            },
          },
        })
      )

      // Create new instance
      const fullSong = await db.getSong(song.uuid)
      const chordpro = await db.getChordPro(fullSong.chordproFileId)
      const parsedContent = parser.parse(chordpro.content)

      const song2 = new LibrarySong(
        {
          ...fullSong,
          parsed: parsedContent,
        },
        db,
        orgId
      )

      const state0 = song2.getSectionState(0)
      expect(state0.hideMode).to.equal('lyrics')

      const state1 = song2.getSectionState(1)
      expect(state1.isCollapsed).to.equal(true)
    })
  })
})

describe('LibrarySong, with little recorded about the song', () => {
  const orgId = `test-org-${crypto.randomUUID()}`
  const bare = (fields: object = {}) =>
    new LibrarySong({ uuid: 'u', id: 'title-x', ...fields } as LoadedSong, {} as ChordlessDB, orgId)

  afterEach(() => localStorage.removeItem(`song-prefs-${orgId}`))

  it('is called Untitled with no title, and has no artist with no author', () => {
    expect(bare().title).to.equal('Untitled')
    expect(bare().artist).to.equal(null)
    expect(bare({ artist: 'Newton' }).artist).to.equal('Newton')
    expect(bare({ author: 'Wesley', artist: 'Newton' }).artist).to.equal('Wesley')
  })

  it('takes the original key and tempo to be the current ones when none were kept', () => {
    const song = bare({ key: 'A', tempo: 80 })
    expect(song.getOriginalKey()).to.equal('A')
    expect(song.getOriginalTempo()).to.equal(80)
    expect(bare({ key: 'A', originalKey: 'G' }).getOriginalKey()).to.equal('G')
  })

  it('adds a section’s state to what was saved for the song, even if that was only a capo', async () => {
    saveSongUserPrefs('title-x', orgId, { capo: 2 })
    const song = bare()
    song.setSectionState(1, { hideMode: 'chords' })
    await song.save()
    const prefs = getSongUserPrefs('title-x', orgId)
    expect(prefs?.capo).to.equal(2)
    expect(prefs?.sectionDefaults?.[1]).to.include({ hideMode: 'chords' })
  })

  it('keeps a capo to a whole number from 0 to 11, and 0 for what is not a number', () => {
    const song = bare()
    song.setCapo(40)
    expect(song.getCapo()).to.equal(11)
    song.setCapo(-3)
    expect(song.getCapo()).to.equal(0)
    song.setCapo('x')
    expect(song.getCapo()).to.equal(0)
    song.setCapo('4')
    expect(song.getCapo()).to.equal(4)
  })

  it('can be reset when it has no key or tempo at all', async () => {
    const song = bare()
    await song.reset()
    expect(song.getKey()).to.equal(undefined)
    expect(song.getCapo()).to.equal(0)
  })
})
