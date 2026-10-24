import { expect } from '@open-wc/testing'
import type { LoadedSong, SetlistEntry } from '../src/js/data-types.ts'
import { ChordlessDB, createSetlist } from '../src/js/db.ts'
import { SetlistSong } from '../src/js/models/setlist-song.ts'
import { ChordProParser } from '../src/js/parser.ts'
import { makeEntry } from './builders.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs, uniqueName } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const clearLocalStorage = (spaceId, setlistId) => {
  localStorage.removeItem(`song-prefs-${spaceId}`)
  localStorage.removeItem(`state-${setlistId}`)
}

const sampleChordPro = `{title: Amazing Grace}
{artist: John Newton}
{key: G}
{tempo: 90}

[Verse 1]
Amazing [G]grace, how [C]sweet the [G]sound

[Chorus]
How [G]precious did that [C]grace ap[G]pear`

describe('SetlistSong', () => {
  let db
  let spaceId
  let setlist
  let canonicalSong
  let parser

  beforeEach(async () => {
    spaceId = `test-org-${uniqueName()}`
    db = new ChordlessDB(spaceId)
    await db.init()
    parser = new ChordProParser()

    // Create a canonical song in the database
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

    canonicalSong = {
      ...fullSong,
      parsed: parsedContent,
    }

    // Create a setlist
    setlist = createSetlist({
      date: '2024-09-01',
      time: '09:30',
      type: 'Church Service',
      name: 'Test Service',
      owner: 'test-user',
    })

    setlist.songs.push({
      order: 0,
      songId: 'ccli-12345',
      key: 'G', // Explicit snapshot from canonical song
      tempo: 90,
      notes: '',
      chordproEdits: null,
    })

    await db.saveSetlist(setlist)

    clearLocalStorage(spaceId, setlist.id)
  })

  afterEach(async () => {
    if (db?.dbName) {
      await deleteDatabase(db.dbName)
      db = null
    }
    if (setlist?.id) {
      clearLocalStorage(spaceId, setlist.id)
    }
  })

  describe('Core Properties', () => {
    it('returns correct id from setlist entry', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      expect(song.id).to.equal('ccli-12345')
    })

    it('returns correct uuid from canonical song', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      expect(song.uuid).to.equal(canonicalSong.uuid)
    })

    it('returns correct title from canonical song', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      expect(song.title).to.equal('Amazing Grace')
    })

    it('returns correct artist from canonical song', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      expect(song.artist).to.equal('John Newton')
    })

    it('returns parsed data from canonical song', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      expect(song.parsed).to.be.an('object')
      expect(song.parsed.sections).to.be.an('array')
    })
  })

  describe('Key and Tempo (from setlist entry)', () => {
    it('returns key from setlist entry', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      expect(song.getKey()).to.equal('G')
    })

    it('allows setting key', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      song.setKey('A')
      expect(song.getKey()).to.equal('A')
    })

    it('persists key changes to setlist in IndexedDB', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      song.setKey('A')
      await song.save()

      const loaded = await db.getSetlist(setlist.id)
      expect(loaded.songs[0].key).to.equal('A')
    })

    it('returns original key from canonical song', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      expect(song.getOriginalKey()).to.equal('G')
    })

    it('returns tempo from setlist entry', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      expect(song.getTempo()).to.equal(90)
    })

    it('allows setting tempo', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      song.setTempo(120)
      expect(song.getTempo()).to.equal(120)
    })

    it('persists tempo changes to setlist in IndexedDB', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      song.setTempo(120)
      await song.save()

      const loaded = await db.getSetlist(setlist.id)
      expect(loaded.songs[0].tempo).to.equal(120)
    })

    it('saves nothing when the song is no longer at its place in the stored setlist', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      song.setKey('A')
      await db.updateSetlist(setlist.id, stored => {
        stored.songs[0].songId = 'another-song'
      })

      await song.save()

      const loaded = await db.getSetlist(setlist.id)
      expect(loaded.songs[0].key).to.equal('G')
    })
  })

  describe('Capo (priority cascade)', () => {
    it('returns 0 when no capo is set anywhere', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      expect(song.getCapo()).to.equal(0)
    })

    it('loads capo from song-user-prefs when keys match', () => {
      // Set song-user-prefs
      const key = `song-prefs-${spaceId}`
      localStorage.setItem(
        key,
        JSON.stringify({
          'ccli-12345': { capo: 2 },
        })
      )

      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      expect(song.getCapo()).to.equal(2)
    })

    it('does NOT load capo from song-user-prefs when keys do not match', () => {
      // Change setlist key to A (different from canonical G)
      setlist.songs[0].key = 'A'

      // Set song-user-prefs with capo
      const key = `song-prefs-${spaceId}`
      localStorage.setItem(
        key,
        JSON.stringify({
          'ccli-12345': { capo: 2 },
        })
      )

      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId)
      expect(song.getCapo()).to.equal(0) // Should ignore user prefs because key doesn't match
    })

    it('setlist localStorage overrides song-user-prefs', () => {
      // Set song-user-prefs
      const prefsKey = `song-prefs-${spaceId}`
      localStorage.setItem(
        prefsKey,
        JSON.stringify({
          'ccli-12345': { capo: 2 },
        })
      )

      // Set setlist state
      const stateKey = `state-${setlist.id}`
      localStorage.setItem(
        stateKey,
        JSON.stringify({
          sectionState: {},
          capoValues: {
            0: 3, // Song at index 0 has capo 3
          },
        })
      )

      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId, 0)
      expect(song.getCapo()).to.equal(3) // Should use setlist state, not user prefs
    })

    it('allows setting capo', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId, 0)
      song.setCapo(4)
      expect(song.getCapo()).to.equal(4)
    })

    it('persists capo to setlist localStorage', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId, 0)
      song.setCapo(4)
      await song.save()

      // (kept under the song, not its place in the setlist; this fixture has no uuid, so by its id)
      const state = JSON.parse(must(localStorage.getItem(`state-${setlist.id}`)))
      expect(state.capos[setlist.songs[0].songId]).to.equal(4)
    })
  })

  describe('Reset', () => {
    it('resets key to original from canonical song', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId, 0)
      song.setKey('A')
      await song.reset()
      expect(song.getKey()).to.equal('G')
    })

    it('resets tempo to original from canonical song', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId, 0)
      song.setTempo(120)
      await song.reset()
      expect(song.getTempo()).to.equal(90)
    })

    it('clears capo from setlist localStorage', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, spaceId, 0)
      song.setCapo(3)
      await song.save()
      await song.reset()

      expect(song.getCapo()).to.equal(0)
    })
  })
})

describe('SetlistSong, with little recorded about the song or the setlist', () => {
  const setlistId = `setlist-${crypto.randomUUID()}`
  const stateKey = `state-${setlistId}`
  const bare = (canonical: object = {}, entry: Partial<SetlistEntry> = {}) =>
    new SetlistSong(
      makeEntry({ songId: 'title-x', ...entry }),
      { uuid: 'u', ...canonical } as LoadedSong,
      setlistId,
      {
        getSetlist: async () => undefined,
        saveSetlist: async () => {},
      } as unknown as ChordlessDB,
      'space',
      0
    )

  afterEach(() => localStorage.removeItem(stateKey))

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
    expect(bare({ tempo: 80, originalTempo: 70 }).getOriginalTempo()).to.equal(70)
  })

  it('adds a capo to a saved state that has none', async () => {
    localStorage.setItem(stateKey, JSON.stringify({}))
    const song = bare()
    song.setCapo(3)
    await song.save()
    const state = JSON.parse(must(localStorage.getItem(stateKey)))
    expect(Object.values(state.capos)).to.deep.equal([3])
  })

  it('can be reset when it has no key or tempo at all', async () => {
    const song = bare()
    await song.reset()
    expect(song.getCapo()).to.equal(0)
  })
})
