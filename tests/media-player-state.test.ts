import { expect } from '@open-wc/testing'
import { loadMediaPlayerState, saveMediaPlayerState } from '../src/js/media-player-state.ts'

const KEYS = [
  'media-player-pads-on',
  'media-player-click-on',
  'media-player-collapsed',
  'media-player-position',
  'pad-volume',
  'click-volume',
]

describe('what the media player remembers of itself', () => {
  beforeEach(() => {
    for (const key of KEYS) localStorage.removeItem(key)
  })
  afterEach(() => {
    for (const key of KEYS) localStorage.removeItem(key)
  })

  it('is on, collapsed and not moved, at a middling volume, until it is saved', () => {
    expect(loadMediaPlayerState()).to.deep.equal({
      padsOn: true,
      clickOn: true,
      collapsed: true,
      position: { x: 0, y: 0 },
      padVolume: 0.5,
      clickVolume: 0.8,
    })
  })

  it('comes back as it was saved', () => {
    saveMediaPlayerState('padsOn', false)
    saveMediaPlayerState('clickOn', false)
    saveMediaPlayerState('collapsed', false)
    saveMediaPlayerState('position', { x: 12, y: 34 })
    saveMediaPlayerState('padVolume', 0.25)
    saveMediaPlayerState('clickVolume', 0)
    expect(loadMediaPlayerState()).to.deep.equal({
      padsOn: false,
      clickOn: false,
      collapsed: false,
      position: { x: 12, y: 34 },
      padVolume: 0.25,
      clickVolume: 0,
    })
  })

  it('uses the defaults for what is stored as something else, or cannot be read', () => {
    localStorage.setItem('media-player-pads-on', '"yes"')
    localStorage.setItem('media-player-click-on', '{not json')
    localStorage.setItem('media-player-position', '{"x":1}')
    localStorage.setItem('media-player-position', 'null')
    localStorage.setItem('pad-volume', '7')
    localStorage.setItem('click-volume', '-1')
    const state = loadMediaPlayerState()
    expect(state.padsOn).to.equal(true)
    expect(state.clickOn).to.equal(true)
    expect(state.position).to.deep.equal({ x: 0, y: 0 })
    expect(state.padVolume).to.equal(0.5)
    expect(state.clickVolume).to.equal(0.8)
  })

  it('works, if it is not remembered, where storage is blocked', () => {
    const realGet = Storage.prototype.getItem
    const realSet = Storage.prototype.setItem
    Storage.prototype.getItem = () => {
      throw new Error('blocked')
    }
    Storage.prototype.setItem = () => {
      throw new Error('blocked')
    }
    try {
      expect(() => saveMediaPlayerState('padsOn', false)).to.not.throw()
      expect(loadMediaPlayerState().padsOn).to.equal(true)
    } finally {
      Storage.prototype.getItem = realGet
      Storage.prototype.setItem = realSet
    }
  })
})
