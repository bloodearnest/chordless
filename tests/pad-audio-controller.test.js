import { expect } from '@esm-bundle/chai'
import { suppressConsoleLogs } from './test-helpers.js'

const { describe, it, before, after } = window

suppressConsoleLogs()

let PadAudioController

class MockAudio {
  constructor() {
    this.src = ''
    this.loop = false
    this.crossOrigin = null
    this.paused = true
  }

  addEventListener() {}
  removeEventListener() {}
  async play() {
    this.paused = false
  }
  pause() {
    this.paused = true
  }
  removeAttribute(attr) {
    if (attr === 'src') {
      this.src = ''
    }
  }
}

class MockGainNode {
  constructor() {
    this.gain = { value: 0 }
  }
  connect() {}
  disconnect() {}
}

class MockChannelNode {
  connect() {}
  disconnect() {}
}

class MockMediaElementSource {
  connect() {}
  disconnect() {}
}

class MockAudioContext {
  constructor() {
    this.state = 'running'
    this.destination = {}
  }

  resume() {
    this.state = 'running'
    return Promise.resolve()
  }

  createMediaElementSource() {
    return new MockMediaElementSource()
  }

  createGain() {
    return new MockGainNode()
  }

  createChannelSplitter() {
    return new MockChannelNode()
  }

  createChannelMerger() {
    return new MockChannelNode()
  }
}

describe('PadAudioController', () => {
  const originals = {
    Audio: window.Audio,
  }

  before(async () => {
    window.Audio = MockAudio
    ;({ PadAudioController } = await import('../js/pad-audio-controller.js'))

    PadAudioController.prototype._resolvePadUrl = async function (key) {
      return key ? `https://example.com/pads/${key}.mp3` : null
    }
    PadAudioController.prototype._fadeIn = async function () {
      this._isPlaying = true
      if (this._audio) {
        this._audio.paused = false
      }
    }
    PadAudioController.prototype._fadeOut = async function () {
      this._isPlaying = false
      if (this._audio) {
        this._audio.paused = true
      }
    }
    PadAudioController.prototype._fadeOutPadGain = async function () {}
  })

  after(() => {
    window.Audio = originals.Audio
  })

  it('requires an AudioContext', () => {
    expect(() => new PadAudioController()).to.throw()
  })

  it('tracks the current key when loading pads', async () => {
    const controller = new PadAudioController(new MockAudioContext())
    expect(await controller.loadPad(null)).to.be.false
    expect(await controller.loadPad('C')).to.be.true
    expect(controller.currentKey).to.equal('C')
  })

  it('plays and stops pads via fade helpers', async () => {
    const controller = new PadAudioController(new MockAudioContext())
    await controller.loadPad('D')
    await controller.play()
    expect(controller.isPlaying).to.be.true
    await controller.stop()
    expect(controller.isPlaying).to.be.false
  })

  it('updates stereo routing', async () => {
    const controller = new PadAudioController(new MockAudioContext())
    await controller.loadPad('E')
    controller.setStereoMode('left')
    expect(controller._stereoMode).to.equal('left')
    controller.setStereoMode('right')
    expect(controller._stereoMode).to.equal('right')
    controller.setStereoMode('both')
    expect(controller._stereoMode).to.equal('both')
  })

  it('crossfades to a new key', async () => {
    const controller = new PadAudioController(new MockAudioContext())
    await controller.loadPad('C')
    await controller.crossfadeTo('G')
    expect(controller.currentKey).to.equal('G')
  })
})
