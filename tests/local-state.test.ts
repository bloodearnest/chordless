import { expect } from '@open-wc/testing'
import {
  clearSetlistLocalState,
  loadSetlistAnnotations,
  loadSetlistLocalState,
  loadSetlistPitch,
  loadSetlistTuning,
  loadSongCapo,
  loadSongPitches,
  sameSong,
  saveSetlistAnnotations,
  saveSetlistLocalState,
  saveSetlistPitch,
  saveSetlistTuning,
  saveSongPitch,
} from '../src/js/setlist/local-state.ts'
import { makeAnnotation } from './builders.ts'

const songs = [
  { songId: 'a', songUuid: 'ua' },
  { songId: 'b', songUuid: 'ub' },
  { songId: 'c', songUuid: 'uc' },
]

const hidden = { hideMode: 'hide', isCollapsed: false, isHidden: true } as const

describe('what a setlist keeps on this device', () => {
  beforeEach(() => localStorage.removeItem('state-s1'))
  afterEach(() => localStorage.removeItem('state-s1'))

  it('is nothing until it is kept, and then what was kept', () => {
    expect(loadSetlistLocalState('s1', songs)).to.deep.equal({ sectionState: {}, capoValues: {} })
    saveSetlistLocalState('s1', { sectionState: { 0: { 1: hidden } }, capoValues: { 2: 4 } }, songs)
    expect(loadSetlistLocalState('s1', songs)).to.deep.equal({
      sectionState: { 0: { 1: hidden } },
      capoValues: { 2: 4 },
    })
  })

  it('reads the older formats: sections at the top, and the capos as capo', () => {
    localStorage.setItem('state-s1', JSON.stringify({ 0: { 1: hidden }, capo: { 3: 2 } }))
    expect(loadSetlistLocalState('s1', songs)).to.deep.equal({
      sectionState: { 0: { 1: hidden } },
      capoValues: { 3: 2 },
    })
  })

  it('is kept by song: a setlist that is reordered or added to leaves it with its song', () => {
    saveSetlistLocalState('s1', { sectionState: { 1: { 0: hidden } }, capoValues: { 1: 4 } }, songs)
    const reordered = [{ songId: 'x', songUuid: 'ux' }, songs[2], songs[1], songs[0]]
    expect(loadSetlistLocalState('s1', reordered)).to.deep.equal({
      sectionState: { 2: { 0: hidden } },
      capoValues: { 2: 4 },
    })
    expect(loadSongCapo('s1', songs[1], 1)).to.equal(4)
    expect(loadSongCapo('s1', songs[0], 0)).to.equal(undefined)
  })

  it('keeps what was set for a song that is out of the setlist, for when it is back', () => {
    saveSetlistLocalState('s1', { sectionState: {}, capoValues: { 2: 5 } }, songs)
    saveSetlistLocalState('s1', { sectionState: {}, capoValues: {} }, [songs[0], songs[1]])
    expect(loadSetlistLocalState('s1', songs).capoValues).to.deep.equal({ 2: 5 })
    // (but a song that is in it and has nothing set has nothing kept)
    saveSetlistLocalState('s1', { sectionState: {}, capoValues: {} }, songs)
    expect(loadSetlistLocalState('s1', songs).capoValues).to.deep.equal({})
  })

  it('a song that is in the setlist twice shares what is set', () => {
    const twice = [songs[0], songs[1], songs[0]]
    saveSetlistLocalState('s1', { sectionState: {}, capoValues: { 2: 3 } }, twice)
    expect(loadSetlistLocalState('s1', twice).capoValues).to.deep.equal({ 0: 3, 2: 3 })
  })

  it('moves what was kept by place to its song at the next save', () => {
    localStorage.setItem(
      'state-s1',
      JSON.stringify({ sectionState: { 0: { 0: hidden } }, capoValues: { 1: 2 } })
    )
    expect(loadSongCapo('s1', songs[1], 1)).to.equal(2)
    saveSetlistLocalState('s1', loadSetlistLocalState('s1', songs), songs)
    expect(JSON.parse(localStorage.getItem('state-s1') ?? '{}')).to.deep.equal({
      v: 2,
      sections: { ua: { 0: hidden } },
      capos: { ub: 2 },
    })
    // (now it goes with the songs)
    expect(loadSetlistLocalState('s1', [songs[1], songs[0]])).to.deep.equal({
      sectionState: { 1: { 0: hidden } },
      capoValues: { 0: 2 },
    })
  })

  it('follows a song whose entry named it by id alone, when the entry is given its uuid', () => {
    const before = [{ songId: 'a' }, { songId: 'b', songUuid: 'ub' }]
    const after = [{ songId: 'a', songUuid: 'ua' }, before[1]]
    const note = makeAnnotation('n1')
    saveSetlistLocalState(
      's1',
      { sectionState: { 0: { 1: hidden } }, capoValues: { 0: 3 } },
      before
    )
    saveSongPitch('s1', before[0], 'eb', before)
    saveSetlistAnnotations('s1', before[0], [note], before)
    // (read before the next save, from where it was kept)
    expect(loadSetlistLocalState('s1', after)).to.deep.equal({
      sectionState: { 0: { 1: hidden } },
      capoValues: { 0: 3 },
    })
    expect(loadSongCapo('s1', after[0], 0)).to.equal(3)
    expect(loadSongPitches('s1', after)).to.deep.equal({ 0: 'eb' })
    expect(loadSetlistAnnotations('s1', after[0])).to.deep.equal([note])
    // (and moved at it, so that what is cleared stays cleared)
    saveSetlistLocalState('s1', { sectionState: {}, capoValues: {} }, after)
    expect(loadSetlistLocalState('s1', after)).to.deep.equal({ sectionState: {}, capoValues: {} })
    expect(loadSongCapo('s1', after[0], 0)).to.equal(undefined)
    expect(loadSetlistAnnotations('s1', after[0])).to.deep.equal([note])
    const kept = JSON.parse(localStorage.getItem('state-s1') ?? '{}')
    expect(Object.keys(kept.pitches)).to.deep.equal(['ua'])
    expect(Object.keys(kept.annotations)).to.deep.equal(['ua'])
  })

  it('leaves what is kept by id while a song of the setlist still goes by it', () => {
    const songs = [{ songId: 'a' }, { songId: 'a', songUuid: 'ua' }]
    saveSetlistLocalState('s1', { sectionState: {}, capoValues: { 0: 2 } }, [{ songId: 'a' }])
    saveSetlistLocalState('s1', { sectionState: {}, capoValues: { 0: 2, 1: 4 } }, songs)
    expect(loadSetlistLocalState('s1', songs).capoValues).to.deep.equal({ 0: 2, 1: 4 })
  })

  it('takes an entry with no uuid to be the same song as one with it, never another song', () => {
    expect(sameSong({ songId: 'a' }, { songId: 'a', songUuid: 'ua' })).to.equal(true)
    expect(sameSong({ songId: 'a', songUuid: 'ua' }, { songId: 'a' })).to.equal(true)
    expect(sameSong({ songId: 'a', songUuid: 'ua' }, { songId: 'a', songUuid: 'other' })).to.equal(
      false
    )
    expect(sameSong({ songId: 'a' }, { songId: 'b' })).to.equal(false)
    expect(sameSong(undefined, { songId: 'a' })).to.equal(false)
  })

  it('is nothing when what was kept cannot be read', () => {
    localStorage.setItem('state-s1', '{not json')
    expect(loadSetlistLocalState('s1', songs)).to.deep.equal({ sectionState: {}, capoValues: {} })
  })

  it('carries on when it cannot be kept, as when storage is full', () => {
    const realSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    try {
      expect(() =>
        saveSetlistLocalState('s1', { sectionState: {}, capoValues: {} }, songs)
      ).to.not.throw()
    } finally {
      Storage.prototype.setItem = realSetItem
    }
  })

  it('is forgotten when the setlist is deleted', () => {
    saveSetlistLocalState('s1', { sectionState: {}, capoValues: { 0: 1 } }, songs)
    clearSetlistLocalState('s1')
    expect(localStorage.getItem('state-s1')).to.equal(null)
  })

  describe('the instrument pitch', () => {
    it('is none until one is kept for the setlist, then kept, and none again for the device’s', () => {
      expect(loadSetlistPitch('s1')).to.equal(null)
      saveSetlistPitch('s1', 'bb', songs)
      expect(loadSetlistPitch('s1')).to.equal('bb')
      saveSetlistPitch('s1', 'concert', songs)
      expect(loadSetlistPitch('s1')).to.equal('concert')
      saveSetlistPitch('s1', null, songs)
      expect(loadSetlistPitch('s1')).to.equal(null)
    })

    it('is kept for a song, by song, and goes with it when the setlist is moved about', () => {
      expect(loadSongPitches('s1', songs)).to.deep.equal({})
      saveSongPitch('s1', songs[2], 'eb', songs)
      expect(loadSongPitches('s1', songs)).to.deep.equal({ 2: 'eb' })
      // (reordered: the song is where it is now)
      expect(loadSongPitches('s1', [songs[2], songs[0], songs[1]])).to.deep.equal({ 0: 'eb' })
      saveSongPitch('s1', songs[0], 'f', songs)
      expect(loadSongPitches('s1', songs)).to.deep.equal({ 0: 'f', 2: 'eb' })
      saveSongPitch('s1', songs[2], null, songs)
      saveSongPitch('s1', songs[0], null, songs)
      expect(loadSongPitches('s1', songs)).to.deep.equal({})
      expect('pitches' in JSON.parse(localStorage.getItem('state-s1') ?? '{}')).to.equal(false)
    })

    it('leaves the sections, capos and tuning alone, and they leave it', () => {
      saveSetlistTuning('s1', 1, songs)
      saveSetlistPitch('s1', 'bb', songs)
      saveSongPitch('s1', songs[1], 'f', songs)
      saveSetlistLocalState('s1', { sectionState: {}, capoValues: { 0: 3 } }, songs)
      expect(loadSetlistTuning('s1')).to.equal(1)
      expect(loadSetlistPitch('s1')).to.equal('bb')
      expect(loadSongPitches('s1', songs)).to.deep.equal({ 1: 'f' })
      expect(loadSetlistLocalState('s1', songs).capoValues).to.deep.equal({ 0: 3 })
    })

    it('is read as concert pitch when what is kept is not a pitch, and none for state kept by place', () => {
      localStorage.setItem(
        'state-s1',
        JSON.stringify({ v: 2, sections: {}, capos: {}, pitch: 'x', pitches: { ua: 'y' } })
      )
      expect(loadSetlistPitch('s1')).to.equal('concert')
      expect(loadSongPitches('s1', songs)).to.deep.equal({ 0: 'concert' })
      localStorage.setItem('state-s1', JSON.stringify({ capo: { 0: 2 } }))
      expect(loadSetlistPitch('s1')).to.equal(null)
      expect(loadSongPitches('s1', songs)).to.deep.equal({})
    })

    it('carries on when it cannot be kept, as when storage is full', () => {
      const real = Storage.prototype.setItem
      Storage.prototype.setItem = () => {
        throw new Error('full')
      }
      try {
        expect(() => saveSetlistPitch('s1', 'bb', songs)).to.not.throw()
        expect(() => saveSongPitch('s1', songs[0], 'bb', songs)).to.not.throw()
      } finally {
        Storage.prototype.setItem = real
      }
    })
  })

  describe('the tuning', () => {
    it('is none until one is kept, then kept, and none again when the device’s is asked for', () => {
      expect(loadSetlistTuning('s1')).to.equal(null)
      saveSetlistTuning('s1', 1, songs)
      expect(loadSetlistTuning('s1')).to.equal(1)
      saveSetlistTuning('s1', 0, songs)
      expect(loadSetlistTuning('s1')).to.equal(0)
      saveSetlistTuning('s1', null, songs)
      expect(loadSetlistTuning('s1')).to.equal(null)
    })

    it('leaves the sections and capos alone, and they leave it', () => {
      saveSetlistLocalState(
        's1',
        { sectionState: { 0: { 1: hidden } }, capoValues: { 2: 4 } },
        songs
      )
      saveSetlistTuning('s1', 2, songs)
      expect(loadSetlistLocalState('s1', songs)).to.deep.equal({
        sectionState: { 0: { 1: hidden } },
        capoValues: { 2: 4 },
      })
      saveSetlistLocalState('s1', { sectionState: {}, capoValues: { 0: 3 } }, songs)
      expect(loadSetlistTuning('s1')).to.equal(2)
    })

    it('is read as standard when what is kept is not a tuning, and none for state kept by place', () => {
      localStorage.setItem('state-s1', JSON.stringify({ v: 2, sections: {}, capos: {}, tuning: 7 }))
      expect(loadSetlistTuning('s1')).to.equal(0)
      localStorage.setItem('state-s1', JSON.stringify({ capo: { 0: 2 } }))
      expect(loadSetlistTuning('s1')).to.equal(null)
    })

    it('carries on when it cannot be kept, as when storage is full', () => {
      const real = Storage.prototype.setItem
      Storage.prototype.setItem = () => {
        throw new Error('full')
      }
      try {
        expect(() => saveSetlistTuning('s1', 1, songs)).to.not.throw()
      } finally {
        Storage.prototype.setItem = real
      }
    })
  })

  describe('private annotations', () => {
    const annotation = {
      id: 'n1',
      anchor: { kind: 'song' },
      body: { kind: 'text', text: 'drop out' },
      modified: '2026-11-01T00:00:00Z',
    } as const

    it('are kept by song, beside the sections and capos, which they leave alone', () => {
      saveSetlistLocalState(
        's1',
        { sectionState: { 1: { 0: hidden } }, capoValues: { 0: 2 } },
        songs
      )
      saveSetlistAnnotations('s1', songs[1], [annotation], songs)
      expect(loadSetlistAnnotations('s1', songs[1])).to.deep.equal([annotation])
      expect(loadSetlistAnnotations('s1', songs[0])).to.deep.equal([])
      expect(loadSetlistLocalState('s1', songs)).to.deep.equal({
        sectionState: { 1: { 0: hidden } },
        capoValues: { 0: 2 },
      })
      // and the sections saved after do not lose them
      saveSetlistLocalState('s1', { sectionState: {}, capoValues: {} }, songs)
      expect(loadSetlistAnnotations('s1', songs[1])).to.deep.equal([annotation])
    })

    it('carry on when they cannot be kept, as when storage is full', () => {
      const realSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = () => {
        throw new DOMException('full', 'QuotaExceededError')
      }
      try {
        expect(() => saveSetlistAnnotations('s1', songs[0], [annotation], songs)).to.not.throw()
      } finally {
        Storage.prototype.setItem = realSetItem
      }
    })

    it('are read from the field they had before they were called annotations, and moved when saved', () => {
      localStorage.setItem(
        'state-s1',
        JSON.stringify({ v: 2, sections: {}, capos: {}, notes: { ub: [annotation] } })
      )
      expect(loadSetlistAnnotations('s1', songs[1])).to.deep.equal([annotation])
      saveSetlistAnnotations('s1', songs[0], [annotation], songs)
      const stored = JSON.parse(localStorage.getItem('state-s1') as string)
      expect('notes' in stored).to.equal(false)
      expect(Object.keys(stored.annotations).sort()).to.deep.equal(['ua', 'ub'])
    })

    it('are forgotten for a song when none are left', () => {
      saveSetlistAnnotations('s1', songs[0], [annotation], songs)
      saveSetlistAnnotations('s1', songs[0], [], songs)
      expect(loadSetlistAnnotations('s1', songs[0])).to.deep.equal([])
    })

    it('keep what was kept by place when the state is first saved by song', () => {
      localStorage.setItem(
        'state-s1',
        JSON.stringify({ sectionState: { 1: { 0: hidden } }, capo: { 2: 5 } })
      )
      saveSetlistAnnotations('s1', songs[0], [annotation], songs)
      expect(loadSetlistLocalState('s1', songs)).to.deep.equal({
        sectionState: { 1: { 0: hidden } },
        capoValues: { 2: 5 },
      })
    })
  })
})
