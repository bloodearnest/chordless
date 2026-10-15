import { expect } from '@open-wc/testing'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

import {
  type ClickAudioContext,
  type ClickEnvelope,
  type ClickOscillator,
  MetronomeController,
} from '../src/js/metronome-controller.ts'
import { wait } from './test-helpers.ts'

class MockAudioContext implements ClickAudioContext {
  state: string
  resumeCalled: boolean
  currentTime: number
  oscillators: MockOscillator[] = []
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
    const oscillator = new MockOscillator()
    this.oscillators.push(oscillator)
    return oscillator
  }

  createGain() {
    return new MockGainNode()
  }

  createMediaElementSource() {
    return {}
  }
}

class MockOscillator implements ClickOscillator {
  frequency: { value: number }
  started: boolean
  stopped: boolean
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

class MockGainNode implements ClickEnvelope {
  gain: ClickEnvelope['gain']
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
    expect(
      () => new MetronomeController(null as unknown as ClickAudioContext, new MockGainNode())
    ).to.throw()
    expect(
      () => new MetronomeController(new MockAudioContext(), null as unknown as ClickEnvelope)
    ).to.throw()
  })

  it('starts and stops the metronome', () => {
    const controller = new MetronomeController(new MockAudioContext(), new MockGainNode())
    expect(controller.start(120, '4/4', '1/4')).to.be.true
    expect(controller.isRunning).to.be.true
    controller.stop()
    expect(controller.isRunning).to.be.false
  })

  it('resumes suspended audio contexts on start', () => {
    const ctx = new MockAudioContext('suspended')
    const controller = new MetronomeController(ctx, new MockGainNode())
    controller.start(120, '4/4', '1/4')
    expect(ctx.resumeCalled).to.be.true
  })

  it('prevents start when BPM or time signature missing', () => {
    const controller = new MetronomeController(new MockAudioContext(), new MockGainNode())
    expect(controller.start(null as unknown as number, '4/4', '1/4')).to.be.false
    expect(controller.start(120, null as unknown as string, '1/4')).to.be.false
    expect(controller.isRunning).to.be.false
  })

  it('adjusts volume via gain node', () => {
    const gain = new MockGainNode()
    const controller = new MetronomeController(new MockAudioContext(), gain)
    controller.setVolume(0.25)
    expect(gain.gain.value).to.equal(0.25)
  })

  it('handles several time signatures', () => {
    const controller = new MetronomeController(new MockAudioContext(), new MockGainNode())
    ;['4/4', '3/4', '6/8', '12/8', '7/8'].forEach(signature => {
      expect(controller.start(100, signature, '1/4')).to.be.true
      expect(controller.isRunning).to.be.true
      controller.stop()
    })
  })

  describe('the sound of each click', () => {
    const HEAVY = 1000
    const MEDIUM = 900
    const LIGHT = 800

    /** The pitch of the first `count` clicks of a song */
    function pitches(
      count: number,
      timeSignature: string,
      options?: { doubleClick?: boolean; emphasiseDownbeat?: boolean }
    ) {
      const ctx = new MockAudioContext()
      const controller = new MetronomeController(ctx, new MockGainNode())
      controller.start(100, timeSignature, '1/4', options)
      for (let i = 1; i < count; i++) controller._playClick()
      controller.stop()
      return ctx.oscillators.slice(0, count).map(oscillator => oscillator.frequency.value)
    }

    it('accents the downbeat', () => {
      expect(pitches(8, '4/4')).to.deep.equal([
        HEAVY,
        LIGHT,
        LIGHT,
        LIGHT,
        HEAVY,
        LIGHT,
        LIGHT,
        LIGHT,
      ])
    })

    it('accents the middle of 6/8', () => {
      expect(pitches(6, '6/8')).to.deep.equal([HEAVY, LIGHT, LIGHT, MEDIUM, LIGHT, LIGHT])
    })

    it('sounds every click the same without the downbeat emphasis', () => {
      expect(pitches(6, '6/8', { emphasiseDownbeat: false })).to.deep.equal(Array(6).fill(LIGHT))
      expect(pitches(8, '4/4', { emphasiseDownbeat: false })).to.deep.equal(Array(8).fill(LIGHT))
    })

    it('clicks again halfway between the beats when doubled, with the downbeat where it was', () => {
      expect(pitches(8, '4/4', { doubleClick: true })).to.deep.equal([
        HEAVY,
        LIGHT,
        LIGHT,
        LIGHT,
        LIGHT,
        LIGHT,
        LIGHT,
        LIGHT,
      ])
      // The downbeat comes round again after eight clicks: four beats
      expect(pitches(9, '4/4', { doubleClick: true })[8]).to.equal(HEAVY)
    })

    it('keeps the 6/8 accent on its beat when doubled', () => {
      const sequence = pitches(12, '6/8', { doubleClick: true })
      expect(sequence[0]).to.equal(HEAVY)
      expect(sequence[6]).to.equal(MEDIUM)
      expect(sequence.filter(pitch => pitch === MEDIUM)).to.have.length(1)
    })

    it('halves the interval between clicks when doubled, which leaves the tempo alone', () => {
      const normal = new MetronomeController(new MockAudioContext(), new MockGainNode())
      const doubled = new MetronomeController(new MockAudioContext(), new MockGainNode())
      normal.start(60, '4/4', '1/4')
      doubled.start(60, '4/4', '1/4', { doubleClick: true })
      expect(normal.beatInterval).to.equal(1000)
      expect(doubled.beatInterval).to.equal(500)
      normal.stop()
      doubled.stop()
    })

    it('can have the emphasis changed while running', () => {
      const ctx = new MockAudioContext()
      const controller = new MetronomeController(ctx, new MockGainNode())
      controller.start(100, '4/4', '1/4')
      controller.setEmphasiseDownbeat(false)
      for (let i = 0; i < 4; i++) controller._playClick()
      controller.stop()
      expect(ctx.oscillators.at(-1)?.frequency.value).to.equal(LIGHT)
    })
  })
})

describe('MetronomeController, tracking the clicks that are sounding', () => {
  const make = () => {
    const controller = new MetronomeController(new MockAudioContext(), new MockGainNode())
    controller.start(100, '4/4', '1/4')
    return controller
  }

  it('forgets a click once it has stopped sounding', async () => {
    const controller = make()
    expect(controller._activeOscillators).to.have.length(1)
    await wait(80)
    expect(controller._activeOscillators).to.have.length(0)
    controller.stop()
  })

  it('has nothing to forget when stopped first, which already let go of them', async () => {
    const controller = make()
    controller.stop()
    expect(controller._activeOscillators).to.have.length(0)
    await wait(80)
    expect(controller._activeOscillators).to.have.length(0)
  })
})

describe('MetronomeController, the details of timing and stopping', () => {
  const make = (ctx = new MockAudioContext()) => new MetronomeController(ctx, new MockGainNode())

  it('clicks by itself, one beat after another, until stopped', async () => {
    const ctx = new MockAudioContext()
    const controller = make(ctx)
    controller.start(600, '4/4', '1/4')
    expect(ctx.oscillators).to.have.length(1)
    await wait(260)
    controller.stop()
    const clicks = ctx.oscillators.length
    expect(clicks).to.be.at.least(3)
    await wait(200)
    expect(ctx.oscillators.length, 'no more once stopped').to.equal(clicks)
  })

  it('does not schedule a click when it is not running', () => {
    const controller = make()
    controller._scheduleNextClick()
    expect(controller._metronomeInterval).to.equal(null)
  })

  it('does not click when it has not been started', () => {
    const ctx = new MockAudioContext()
    make(ctx)._playClick()
    expect(ctx.oscillators).to.have.length(0)
  })

  it('takes the beat to be another note than a quarter when told, and keeps a quarter for no note', () => {
    const interval = (note: string | null | undefined) => {
      const controller = make()
      controller.start(120, '4/4', note as string)
      const result = controller.beatInterval
      controller.stop()
      return result
    }
    expect(interval('1/4')).to.equal(500)
    expect(interval('1/8')).to.equal(1000)
    expect(interval('1/2')).to.equal(250)
    expect(interval('x/y'), 'a note it cannot read').to.equal(500)
    expect(interval(null)).to.equal(500)
    expect(interval('undefined')).to.equal(500)
    expect(interval('null')).to.equal(500)
  })

  it('takes a dotted-quarter tempo in compound time as three eighths, clicking on each', () => {
    const controller = make()
    controller.start(60, '6/8', '1/4')
    expect(controller.beatInterval).to.be.closeTo(60000 / 90 / 2, 0.01)
    controller.stop()
  })

  it('accents the beats of 12/8 as 4/4: medium on the third, sixth and ninth', () => {
    const ctx = new MockAudioContext()
    const controller = make(ctx)
    controller.start(100, '12/8', '1/4')
    for (let i = 1; i < 12; i++) controller._playClick()
    controller.stop()
    const pitches = ctx.oscillators.map(oscillator => oscillator.frequency.value)
    expect(pitches[0]).to.equal(1000)
    expect([pitches[3], pitches[6], pitches[9]]).to.deep.equal([900, 900, 900])
    expect(pitches.filter(pitch => pitch === 900)).to.have.length(3)
  })

  it('stops the clicks that are sounding even if one will not stop', () => {
    const ctx = new MockAudioContext()
    const controller = make(ctx)
    controller.start(100, '4/4', '1/4')
    ctx.oscillators[0].stop = () => {
      throw new Error('already stopped')
    }
    expect(() => controller.stop()).to.not.throw()
    expect(controller.isRunning).to.equal(false)
  })
})
