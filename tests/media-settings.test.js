import { expect } from '@esm-bundle/chai'
import { loadMediaSettings, saveMediaSettings } from '../public/js/media-settings.js'

const { describe, it } = window

/** A Storage-like object backed by a Map */
function fakeStorage(items = {}) {
  const map = new Map(Object.entries(items))
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    map,
  }
}

const defaults = {
  mediaPlayerEnabled: true,
  padsEnabled: true,
  metronomeEnabled: true,
  stereoSplitEnabled: false,
}

describe('media settings', () => {
  it('defaults to everything on except stereo split', () => {
    expect(loadMediaSettings(fakeStorage())).to.deep.equal(defaults)
  })

  it('reads saved settings, filling in missing ones', () => {
    const storage = fakeStorage({
      'media-settings': JSON.stringify({ mediaPlayerEnabled: false, stereoSplitEnabled: true }),
    })
    expect(loadMediaSettings(storage)).to.deep.equal({
      ...defaults,
      mediaPlayerEnabled: false,
      stereoSplitEnabled: true,
    })
  })

  it('reads settings saved under the old key', () => {
    const storage = fakeStorage({ mediaPlayerSettings: JSON.stringify({ padsEnabled: false }) })
    expect(loadMediaSettings(storage).padsEnabled).to.equal(false)
  })

  it('prefers the current key to the old one', () => {
    const storage = fakeStorage({
      'media-settings': JSON.stringify({ padsEnabled: true }),
      mediaPlayerSettings: JSON.stringify({ padsEnabled: false }),
    })
    expect(loadMediaSettings(storage).padsEnabled).to.equal(true)
  })

  it('uses the defaults when the saved settings are unreadable', () => {
    expect(loadMediaSettings(fakeStorage({ 'media-settings': '{not json' }))).to.deep.equal(
      defaults
    )
  })

  it('saves under the current key and drops the old one', () => {
    const storage = fakeStorage({ mediaPlayerSettings: '{}' })
    saveMediaSettings({ ...defaults, metronomeEnabled: false }, storage)
    expect(storage.map.has('mediaPlayerSettings')).to.equal(false)
    expect(loadMediaSettings(storage).metronomeEnabled).to.equal(false)
  })
})
