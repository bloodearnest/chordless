import { expect } from '@esm-bundle/chai'
import { getSongUserPrefs, saveSongUserPrefs, setSongUserPref } from '../src/js/song-user-prefs.ts'

const { describe, it, beforeEach, afterEach } = window

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
})
