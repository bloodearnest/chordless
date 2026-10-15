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
  const org = 'test-org'
  const song = 'ccli-1'

  beforeEach(() => localStorage.removeItem(`song-prefs-${org}`))
  afterEach(() => localStorage.removeItem(`song-prefs-${org}`))

  it('keeps the double click and the pad set beside the capo', () => {
    saveSongUserPrefs(song, org, { capo: 2 })
    setSongUserPref(song, org, 'doubleClick', true)
    setSongUserPref(song, org, 'padSetId', 'drive-warm')
    expect(getSongUserPrefs(song, org)).to.deep.equal({
      capo: 2,
      doubleClick: true,
      padSetId: 'drive-warm',
    })
  })

  it('keeps a "no" different from no choice', () => {
    setSongUserPref(song, org, 'doubleClick', false)
    expect(getSongUserPrefs(song, org)?.doubleClick).to.equal(false)
  })

  it('clears one choice without touching the others', () => {
    saveSongUserPrefs(song, org, { capo: 2, doubleClick: true })
    setSongUserPref(song, org, 'doubleClick', undefined)
    expect(getSongUserPrefs(song, org)).to.deep.equal({ capo: 2 })
  })

  it('drops a song left with no preferences', () => {
    setSongUserPref(song, org, 'padSetId', 'drive-warm')
    setSongUserPref(song, org, 'padSetId', undefined)
    expect(getSongUserPrefs(song, org)).to.equal(null)
  })

  it('is per song', () => {
    setSongUserPref(song, org, 'doubleClick', true)
    expect(getSongUserPrefs('ccli-2', org)).to.equal(null)
  })

  describe('with nothing to say who they are for', () => {
    it('reads, writes and clears nothing', () => {
      expect(getSongUserPrefs('', org)).to.equal(null)
      expect(getSongUserPrefs(song, '')).to.equal(null)
      saveSongUserPrefs('', org, { capo: 1 })
      saveSongUserPrefs(song, '', { capo: 1 })
      setSongUserPref('', org, 'doubleClick', true)
      clearSongUserPrefs('', org)
      expect(getAllSongUserPrefs('')).to.deep.equal({})
      clearAllSongUserPrefs('')
      expect(localStorage.getItem(`song-prefs-${org}`)).to.equal(null)
    })
  })

  describe('all of an organisation', () => {
    it('lists every song, and clears them all', () => {
      saveSongUserPrefs('a', org, { capo: 1 })
      saveSongUserPrefs('b', org, { capo: 2 })
      expect(getAllSongUserPrefs(org)).to.deep.equal({ a: { capo: 1 }, b: { capo: 2 } })
      clearSongUserPrefs('a', org)
      expect(Object.keys(getAllSongUserPrefs(org))).to.deep.equal(['b'])
      clearAllSongUserPrefs(org)
      expect(getAllSongUserPrefs(org)).to.deep.equal({})
    })
  })

  describe('when what is stored is damaged', () => {
    beforeEach(() => localStorage.setItem(`song-prefs-${org}`, '{not json'))

    it('finds none, and says so', () => {
      expect(getSongUserPrefs(song, org)).to.equal(null)
      expect(getAllSongUserPrefs(org)).to.deep.equal({})
    })

    it('leaves it alone rather than lose it, when saving, setting or clearing', () => {
      saveSongUserPrefs(song, org, { capo: 1 })
      setSongUserPref(song, org, 'padSetId', 'x')
      clearSongUserPrefs(song, org)
      expect(localStorage.getItem(`song-prefs-${org}`)).to.equal('{not json')
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
      expect(() => clearAllSongUserPrefs(org)).to.not.throw()
    })
  })
})
