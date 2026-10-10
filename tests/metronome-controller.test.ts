import { expect } from '@esm-bundle/chai'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

import { MetronomeController } from '../src/js/metronome-controller.ts'

class MockAudioContext {
  state: any

  resumeCalled: any

  currentTime: any
  constructor(state = 'running') {
    this.state = state
    this.resumeCalled = false
    this.currentTime = 0
  }

  resume() {
    this.resumeCalled = true
    this.state = 'running'
    return Promise.resolve()
  }

  createOscillator() {
    return new MockOscillator()
  }

  createGain() {
    return new MockGainNode()
  }

  createMediaElementSource() {
    return {}
  }
}

class MockOscillator {
  frequency: any

  started: any

  stopped: any
  constructor() {
    this.frequency = { value: 0 }
    this.started = false
    this.stopped = false
  }

  connect() {}
  disconnect() {}

  start() {
    this.started = true
  }

  stop() {
    this.stopped = true
  }
}

class MockGainNode {
  gain: any
  constructor() {
    this.gain = {
      value: 1,
      setValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    }
  }

  connect() {}
  disconnect() {}
}

describe('MetronomeController', () => {
  it('requires an AudioContext and GainNode', () => {
    expect(() => new MetronomeController(null, new MockGainNode() as any)).to.throw()
    expect(() => new MetronomeController(new MockAudioContext() as any, null)).to.throw()
  })

  it('starts and stops the metronome', () => {
    const controller = new MetronomeController(
      new MockAudioContext() as any,
      new MockGainNode() as any
    )
    expect(controller.start(120, '4/4', '1/4')).to.be.true
    expect(controller.isRunning).to.be.true
    controller.stop()
    expect(controller.isRunning).to.be.false
  })

  it('resumes suspended audio contexts on start', () => {
    const ctx = new MockAudioContext('suspended')
    const controller = new MetronomeController(ctx as any, new MockGainNode() as any)
    controller.start(120, '4/4', '1/4')
    expect(ctx.resumeCalled).to.be.true
  })

  it('prevents start when BPM or time signature missing', () => {
    const controller = new MetronomeController(
      new MockAudioContext() as any,
      new MockGainNode() as any
    )
    expect(controller.start(null, '4/4', '1/4')).to.be.false
    expect(controller.start(120, null, '1/4')).to.be.false
    expect(controller.isRunning).to.be.false
  })

  it('adjusts volume via gain node', () => {
    const gain = new MockGainNode()
    const controller = new MetronomeController(new MockAudioContext() as any, gain as any)
    controller.setVolume(0.25)
    expect(gain.gain.value).to.equal(0.25)
  })

  it('handles several time signatures', () => {
    const controller = new MetronomeController(
      new MockAudioContext() as any,
      new MockGainNode() as any
    )
    ;['4/4', '3/4', '6/8', '12/8', '7/8'].forEach(signature => {
      expect(controller.start(100, signature, '1/4')).to.be.true
      expect(controller.isRunning).to.be.true
      controller.stop()
    })
  })
})
