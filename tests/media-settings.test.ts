import { expect } from '@esm-bundle/chai'
import { loadMediaSettings, saveMediaSettings } from '../src/js/media-settings.ts'

const { describe, it } = window

/** A Storage-like object backed by a Map */
function fakeStorage(items: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(items))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
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
