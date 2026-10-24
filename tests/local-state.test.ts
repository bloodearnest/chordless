import { expect } from '@open-wc/testing'
import {
  clearSetlistLocalState,
  loadSetlistLocalState,
  loadSongCapo,
  saveSetlistLocalState,
} from '../src/js/setlist/local-state.ts'

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
})
