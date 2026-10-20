import { expect } from '@open-wc/testing'
import {
  clearAllSongUserPrefs,
  clearSongUserPrefs,
  getAllSongUserPrefs,
  getSongUserPrefs,
  saveSongUserPrefs,
  setSongUserPref,
} from '../src/js/song-user-prefs.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('song user preferences for the media player', () => {
  const space = 'test-org'
  const song = 'ccli-1'

  beforeEach(() => localStorage.removeItem(`song-prefs-${space}`))
  afterEach(() => localStorage.removeItem(`song-prefs-${space}`))

  it('keeps the double click and the pad set beside the capo', () => {
    saveSongUserPrefs(song, space, { capo: 2 })
    setSongUserPref(song, space, 'doubleClick', true)
    setSongUserPref(song, space, 'padSetId', 'drive-warm')
    expect(getSongUserPrefs(song, space)).to.deep.equal({
      capo: 2,
      doubleClick: true,
      padSetId: 'drive-warm',
    })
  })

  it('keeps a "no" different from no choice', () => {
    setSongUserPref(song, space, 'doubleClick', false)
    expect(getSongUserPrefs(song, space)?.doubleClick).to.equal(false)
  })

  it('clears one choice without touching the others', () => {
    saveSongUserPrefs(song, space, { capo: 2, doubleClick: true })
    setSongUserPref(song, space, 'doubleClick', undefined)
    expect(getSongUserPrefs(song, space)).to.deep.equal({ capo: 2 })
  })

  it('drops a song left with no preferences', () => {
    setSongUserPref(song, space, 'padSetId', 'drive-warm')
    setSongUserPref(song, space, 'padSetId', undefined)
    expect(getSongUserPrefs(song, space)).to.equal(null)
  })

  it('is per song', () => {
    setSongUserPref(song, space, 'doubleClick', true)
    expect(getSongUserPrefs('ccli-2', space)).to.equal(null)
  })

  describe('with nothing to say who they are for', () => {
    it('reads, writes and clears nothing', () => {
      expect(getSongUserPrefs('', space)).to.equal(null)
      expect(getSongUserPrefs(song, '')).to.equal(null)
      saveSongUserPrefs('', space, { capo: 1 })
      saveSongUserPrefs(song, '', { capo: 1 })
      setSongUserPref('', space, 'doubleClick', true)
      clearSongUserPrefs('', space)
      expect(getAllSongUserPrefs('')).to.deep.equal({})
      clearAllSongUserPrefs('')
      expect(localStorage.getItem(`song-prefs-${space}`)).to.equal(null)
    })
  })

  describe('all of a space', () => {
    it('lists every song, and clears them all', () => {
      saveSongUserPrefs('a', space, { capo: 1 })
      saveSongUserPrefs('b', space, { capo: 2 })
      expect(getAllSongUserPrefs(space)).to.deep.equal({ a: { capo: 1 }, b: { capo: 2 } })
      clearSongUserPrefs('a', space)
      expect(Object.keys(getAllSongUserPrefs(space))).to.deep.equal(['b'])
      clearAllSongUserPrefs(space)
      expect(getAllSongUserPrefs(space)).to.deep.equal({})
    })
  })

  describe('when what is stored is damaged', () => {
    beforeEach(() => localStorage.setItem(`song-prefs-${space}`, '{not json'))

    it('finds none, and says so', () => {
      expect(getSongUserPrefs(song, space)).to.equal(null)
      expect(getAllSongUserPrefs(space)).to.deep.equal({})
    })

    it('leaves it alone rather than lose it, when saving, setting or clearing', () => {
      saveSongUserPrefs(song, space, { capo: 1 })
      setSongUserPref(song, space, 'padSetId', 'x')
      clearSongUserPrefs(song, space)
      expect(localStorage.getItem(`song-prefs-${space}`)).to.equal('{not json')
    })
  })

  describe('when storage is blocked', () => {
    const realRemove = Storage.prototype.removeItem
    afterEach(() => {
      Storage.prototype.removeItem = realRemove
    })

    it('copes with not being able to clear everything', () => {
      Storage.prototype.removeItem = () => {
        throw new Error('blocked')
      }
      expect(() => clearAllSongUserPrefs(space)).to.not.throw()
    })
  })
})
