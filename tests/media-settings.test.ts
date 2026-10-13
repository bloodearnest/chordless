import { expect } from '@esm-bundle/chai'
import { loadMediaSettings, saveMediaSettings, wantsDoubleClick } from '../src/js/media-settings.ts'

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
  emphasiseDownbeat: true,
  autoDoubleClick: true,
  doubleClickBelowBpm: 72,
}

describe('media settings', () => {
  it('defaults to everything on except stereo split, with the double click at or below 72 BPM', () => {
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

describe('wantsDoubleClick', () => {
  const on = { autoDoubleClick: true, doubleClickBelowBpm: 72 }

  it('is on at the threshold and below it, and off above', () => {
    expect(wantsDoubleClick(on, 60)).to.equal(true)
    expect(wantsDoubleClick(on, 72)).to.equal(true)
    expect(wantsDoubleClick(on, 73)).to.equal(false)
  })

  it('is off without a tempo', () => {
    expect(wantsDoubleClick(on, null)).to.equal(false)
    expect(wantsDoubleClick(on, 0)).to.equal(false)
  })

  it('is off when switched off, whatever the tempo', () => {
    expect(wantsDoubleClick({ ...on, autoDoubleClick: false }, 50)).to.equal(false)
  })

  it("goes by the song's own choice, either way, when it has one", () => {
    expect(wantsDoubleClick(on, 120, true)).to.equal(true)
    expect(wantsDoubleClick(on, 50, false)).to.equal(false)
    expect(wantsDoubleClick({ ...on, autoDoubleClick: false }, 50, true)).to.equal(true)
  })

  it('ignores a threshold that is not a positive number', () => {
    const storage = fakeStorage({ 'media-settings': JSON.stringify({ doubleClickBelowBpm: -5 }) })
    expect(loadMediaSettings(storage).doubleClickBelowBpm).to.equal(72)
  })
})
