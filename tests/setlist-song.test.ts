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

const clearLocalStorage = (orgId, setlistId) => {
  localStorage.removeItem(`song-prefs-${orgId}`)
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
  let orgId
  let setlist
  let canonicalSong
  let parser

  beforeEach(async () => {
    orgId = `test-org-${uniqueName()}`
    db = new ChordlessDB(orgId)
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

    clearLocalStorage(orgId, setlist.id)
  })

  afterEach(async () => {
    if (db?.dbName) {
      await deleteDatabase(db.dbName)
      db = null
    }
    if (setlist?.id) {
      clearLocalStorage(orgId, setlist.id)
    }
  })

  describe('Core Properties', () => {
    it('returns correct id from setlist entry', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      expect(song.id).to.equal('ccli-12345')
    })

    it('returns correct uuid from canonical song', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      expect(song.uuid).to.equal(canonicalSong.uuid)
    })

    it('returns correct title from canonical song', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      expect(song.title).to.equal('Amazing Grace')
    })

    it('returns correct artist from canonical song', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      expect(song.artist).to.equal('John Newton')
    })

    it('returns parsed data from canonical song', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      expect(song.parsed).to.be.an('object')
      expect(song.parsed.sections).to.be.an('array')
    })
  })

  describe('Key and Tempo (from setlist entry)', () => {
    it('returns key from setlist entry', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      expect(song.getKey()).to.equal('G')
    })

    it('allows setting key', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      song.setKey('A')
      expect(song.getKey()).to.equal('A')
    })

    it('persists key changes to setlist in IndexedDB', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      song.setKey('A')
      await song.save()

      const loaded = await db.getSetlist(setlist.id)
      expect(loaded.songs[0].key).to.equal('A')
    })

    it('returns original key from canonical song', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      expect(song.getOriginalKey()).to.equal('G')
    })

    it('returns tempo from setlist entry', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      expect(song.getTempo()).to.equal(90)
    })

    it('allows setting tempo', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      song.setTempo(120)
      expect(song.getTempo()).to.equal(120)
    })

    it('persists tempo changes to setlist in IndexedDB', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      song.setTempo(120)
      await song.save()

      const loaded = await db.getSetlist(setlist.id)
      expect(loaded.songs[0].tempo).to.equal(120)
    })
  })

  describe('Capo (priority cascade)', () => {
    it('returns 0 when no capo is set anywhere', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      expect(song.getCapo()).to.equal(0)
    })

    it('loads capo from song-user-prefs when keys match', () => {
      // Set song-user-prefs
      const key = `song-prefs-${orgId}`
      localStorage.setItem(
        key,
        JSON.stringify({
          'ccli-12345': { capo: 2 },
        })
      )

      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      expect(song.getCapo()).to.equal(2)
    })

    it('does NOT load capo from song-user-prefs when keys do not match', () => {
      // Change setlist key to A (different from canonical G)
      setlist.songs[0].key = 'A'

      // Set song-user-prefs with capo
      const key = `song-prefs-${orgId}`
      localStorage.setItem(
        key,
        JSON.stringify({
          'ccli-12345': { capo: 2 },
        })
      )

      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId)
      expect(song.getCapo()).to.equal(0) // Should ignore user prefs because key doesn't match
    })

    it('setlist localStorage overrides song-user-prefs', () => {
      // Set song-user-prefs
      const prefsKey = `song-prefs-${orgId}`
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

      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId, 0)
      expect(song.getCapo()).to.equal(3) // Should use setlist state, not user prefs
    })

    it('allows setting capo', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId, 0)
      song.setCapo(4)
      expect(song.getCapo()).to.equal(4)
    })

    it('persists capo to setlist localStorage', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId, 0)
      song.setCapo(4)
      await song.save()

      const stateKey = `state-${setlist.id}`
      const state = JSON.parse(must(localStorage.getItem(stateKey)))
      expect(state.capoValues['0']).to.equal(4)
    })
  })

  describe('Section State (priority cascade)', () => {
    it('returns default section state when nothing is set', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId, 0)
      const state = song.getSectionState(0)
      expect(state.hideMode).to.equal('none')
      expect(state.isCollapsed).to.equal(false)
      expect(state.isHidden).to.equal(false)
    })

    it('loads section state from song-user-prefs', () => {
      const key = `song-prefs-${orgId}`
      localStorage.setItem(
        key,
        JSON.stringify({
          'ccli-12345': {
            sectionDefaults: {
              0: { hideMode: 'chords', isCollapsed: false, isHidden: false },
            },
          },
        })
      )

      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId, 0)
      const state = song.getSectionState(0)
      expect(state.hideMode).to.equal('chords')
    })

    it('setlist localStorage overrides song-user-prefs', () => {
      // Set song-user-prefs
      const prefsKey = `song-prefs-${orgId}`
      localStorage.setItem(
        prefsKey,
        JSON.stringify({
          'ccli-12345': {
            sectionDefaults: {
              0: { hideMode: 'chords', isCollapsed: false, isHidden: false },
            },
          },
        })
      )

      // Set setlist state
      const stateKey = `state-${setlist.id}`
      localStorage.setItem(
        stateKey,
        JSON.stringify({
          sectionState: {
            0: {
              // Song index 0
              0: { hideMode: 'lyrics', isCollapsed: true, isHidden: false }, // Section index 0
            },
          },
          capoValues: {},
        })
      )

      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId, 0)
      const state = song.getSectionState(0)
      expect(state.hideMode).to.equal('lyrics') // Should use setlist state
      expect(state.isCollapsed).to.equal(true)
    })

    it('allows setting section state', () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId, 0)
      song.setSectionState(0, { hideMode: 'chords', isCollapsed: false, isHidden: false })
      const state = song.getSectionState(0)
      expect(state.hideMode).to.equal('chords')
    })

    it('persists section state to setlist localStorage', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId, 0)
      song.setSectionState(0, { hideMode: 'chords', isCollapsed: false, isHidden: false })
      song.setSectionState(1, { hideMode: 'lyrics', isCollapsed: true, isHidden: false })
      await song.save()

      const stateKey = `state-${setlist.id}`
      const state = JSON.parse(must(localStorage.getItem(stateKey)))
      expect(state.sectionState['0']['0'].hideMode).to.equal('chords')
      expect(state.sectionState['0']['1'].hideMode).to.equal('lyrics')
      expect(state.sectionState['0']['1'].isCollapsed).to.equal(true)
    })
  })

  describe('Reset', () => {
    it('resets key to original from canonical song', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId, 0)
      song.setKey('A')
      await song.reset()
      expect(song.getKey()).to.equal('G')
    })

    it('resets tempo to original from canonical song', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId, 0)
      song.setTempo(120)
      await song.reset()
      expect(song.getTempo()).to.equal(90)
    })

    it('clears capo from setlist localStorage', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId, 0)
      song.setCapo(3)
      await song.save()
      await song.reset()

      expect(song.getCapo()).to.equal(0)
    })

    it('clears section states from setlist localStorage', async () => {
      const song = new SetlistSong(setlist.songs[0], canonicalSong, setlist.id, db, orgId, 0)
      song.setSectionState(0, { hideMode: 'chords', isCollapsed: false, isHidden: false })
      await song.save()
      await song.reset()

      const state = song.getSectionState(0)
      expect(state.hideMode).to.equal('none')
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
      'org',
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

  it('adds a capo and section states to a saved state that has neither', async () => {
    localStorage.setItem(stateKey, JSON.stringify({}))
    const song = bare()
    song.setCapo(3)
    song.setSectionState(1, { hideMode: 'chords' })
    await song.save()
    const state = JSON.parse(must(localStorage.getItem(stateKey)))
    expect(state.capoValues).to.deep.equal({ 0: 3 })
    expect(state.sectionState[0][1]).to.include({ hideMode: 'chords' })
  })

  it('can be reset when it has no key or tempo at all', async () => {
    const song = bare()
    await song.reset()
    expect(song.getCapo()).to.equal(0)
  })

  it('starts from an empty state when the saved one is damaged', () => {
    const error = console.error
    console.error = () => {}
    try {
      localStorage.setItem(stateKey, '{not json')
      expect(bare()._loadSetlistState()).to.deep.equal({ sectionState: {}, capoValues: {} })
    } finally {
      console.error = error
    }
  })

  it('carries on when the state cannot be kept, as when storage is full', () => {
    const error = console.error
    const realSetItem = Storage.prototype.setItem
    console.error = () => {}
    Storage.prototype.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    try {
      expect(() => bare()._saveSetlistState({ sectionState: {}, capoValues: {} })).to.not.throw()
    } finally {
      Storage.prototype.setItem = realSetItem
      console.error = error
    }
  })
})
