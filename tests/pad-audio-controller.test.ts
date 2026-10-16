import { expect } from '@open-wc/testing'
import { PadAudioController } from '../src/js/pad-audio-controller.ts'
import { PAD_FILE_KEYS } from '../src/js/pad-keys.ts'
import { getPadCacheUrl, type PadSet } from '../src/js/pad-set-service.ts'
import { installFakeTimers, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, before, after, beforeEach, afterEach } = window

suppressConsoleLogs()

const realSetTimeout = window.setTimeout.bind(window)

/** An audio element that plays at once, and tells its listeners what happens to it */
class MockAudio {
  static failPlay = false
  src = ''
  loop = false
  crossOrigin: string | null = null
  paused = true
  currentTime = 0
  plays = 0
  private listeners = new Map<string, Set<(event: Event) => void>>()

  addEventListener(type: string, listener: (event: Event) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)?.add(listener)
  }
  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener)
  }
  hasListener(type: string) {
    return (this.listeners.get(type)?.size ?? 0) > 0
  }
  fire(type: string) {
    const event = new Event(type)
    Object.defineProperty(event, 'target', { value: this })
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
  async play() {
    if (MockAudio.failPlay) throw new Error('NotAllowedError')
    this.plays++
    this.paused = false
    this.currentTime = 0.01
  }
  pause() {
    this.paused = true
  }
  removeAttribute(attribute: string) {
    if (attribute === 'src') this.src = ''
  }
}

/** A node that remembers what it is connected to */
class MockNode {
  connections: { to: unknown; output?: number; input?: number }[] = []
  connect(to: unknown, output?: number, input?: number) {
    this.connections.push({ to, output, input })
  }
  disconnect() {
    this.connections = []
  }
}

class MockGain extends MockNode {
  gain = { value: 0 }
}
class MockSplitter extends MockNode {}
class MockMerger extends MockNode {}

class MockAudioContext {
  state: 'running' | 'suspended' = 'running'
  destination = { name: 'destination' }
  gains: MockGain[] = []
  splitters: MockSplitter[] = []
  mergers: MockMerger[] = []
  resumed = 0

  async resume() {
    this.resumed++
    this.state = 'running'
  }
  createMediaElementSource() {
    return new MockNode()
  }
  createGain() {
    const gain = new MockGain()
    this.gains.push(gain)
    return gain
  }
  createChannelSplitter() {
    const splitter = new MockSplitter()
    this.splitters.push(splitter)
    return splitter
  }
  createChannelMerger() {
    const merger = new MockMerger()
    this.mergers.push(merger)
    return merger
  }
}

/** A pad set whose pads the app has already kept, so loading one needs no Drive */
const PADS: PadSet = { id: 'pads', name: 'Pads' }

describe('PadAudioController', () => {
  const realAudio = window.Audio
  let audios: MockAudio[]
  let context: MockAudioContext
  let clock: ReturnType<typeof installFakeTimers>

  // Fades of 600 ms make a step 10 ms, and the arithmetic exact
  const FADE = 600
  const VOLUME = 0.7

  before(() => {
    window.Audio = class extends MockAudio {
      constructor() {
        super()
        audios.push(this)
      }
    } as unknown as typeof Audio
  })

  after(() => {
    window.Audio = realAudio
  })

  beforeEach(async () => {
    const kept = await caches.open('padsets-cache-v1')
    for (const key of PAD_FILE_KEYS) {
      await kept.put(getPadCacheUrl(PADS.id, key), new Response('pad'))
    }
    audios = []
    MockAudio.failPlay = false
    context = new MockAudioContext()
    clock = installFakeTimers()
  })

  afterEach(async () => {
    clock.uninstall()
    await caches.delete('padsets-cache-v1')
  })

  const make = () =>
    new PadAudioController(context as unknown as AudioContext, { fadeDuration: FADE })

  /** A controller with a pad loaded and faded in all the way */
  async function playing() {
    const controller = make()
    await controller.loadPad('C', PADS)
    await controller.play()
    await clock.tick(FADE)
    return controller
  }

  describe('loading', () => {
    it('requires an AudioContext', () => {
      expect(() => new PadAudioController(null as unknown as AudioContext)).to.throw(
        'AudioContext is required'
      )
    })

    it('loads the pad for a key, looping, and remembers the key', async () => {
      const controller = make()
      expect(await controller.loadPad('C', PADS)).to.equal(true)
      expect(controller.currentKey).to.equal('C')
      expect(controller.loadFailed).to.equal(false)
      expect(audios).to.have.length(1)
      expect(audios[0].src).to.include('/pad-sets/pads/C.mp3')
      expect(audios[0].loop).to.equal(true)
    })

    it('uses the pad file of the sharp for a flat key', async () => {
      const controller = make()
      await controller.loadPad('Bb', PADS)
      expect(audios[0].src).to.include('/pad-sets/pads/A%23.mp3')
    })

    it('has no pad to load without a pad set: the app ships none', async () => {
      const controller = make()
      expect(await controller.loadPad('C')).to.equal(false)
      expect(controller.loadFailed).to.equal(true)
      expect(audios[0].src).to.equal('')
    })

    it('does nothing without a key', async () => {
      const controller = make()
      expect(await controller.loadPad('')).to.equal(false)
      expect(audios).to.have.length(0)
    })

    it('says so when there is no pad for the key, and clears the old one', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      expect(await controller.loadPad('xyz', PADS)).to.equal(false)
      expect(controller.loadFailed).to.equal(true)
      expect(audios[0].src).to.equal('')
    })
  })

  describe('playing', () => {
    it('starts silent and fades in on a curve that eases up to the volume', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      const gain = context.gains[0]
      await controller.play()
      expect(audios[0].paused).to.equal(false)
      expect(gain.gain.value).to.equal(0)

      await clock.tick(FADE / 2)
      // A quarter of the way up at halfway: a slow start
      expect(gain.gain.value).to.be.closeTo(VOLUME * 0.25, 0.001)
      expect(controller.isPlaying).to.equal(true)

      await clock.tick(FADE / 2)
      expect(gain.gain.value).to.equal(VOLUME)
    })

    it('takes a duration for one fade, not the usual', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      await controller.play(200)
      await clock.tick(201)
      expect(context.gains[0].gain.value).to.equal(VOLUME)
    })

    it('has nothing to play before a pad is loaded', async () => {
      const controller = make()
      const error = console.error
      console.error = () => {}
      await controller.play()
      console.error = error
      expect(controller.isPlaying).to.equal(false)
      expect(audios).to.have.length(0)
    })

    it('wakes a suspended audio context first', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      context.state = 'suspended'
      await controller.play()
      expect(context.resumed).to.equal(1)
    })

    it('waits for the audio to start, but not for ever', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      // An element that is slow to start: it never says "playing"
      const play = audios[0].play.bind(audios[0])
      audios[0].play = async () => {
        await play()
        audios[0].currentTime = 0
      }
      let started = false
      controller.play().then(() => {
        started = true
      })
      await clock.tick(199)
      expect(started).to.equal(false)
      await clock.tick(1)
      expect(started).to.equal(true)
    })

    it('does not restart a pad that is already playing, or drop its volume', async () => {
      const controller = await playing()
      await controller.play()
      expect(audios[0].plays).to.equal(1)
      expect(context.gains[0].gain.value).to.equal(VOLUME)
      await clock.tick(FADE)
      expect(context.gains[0].gain.value).to.equal(VOLUME)
    })

    it('marks the load as failed if the browser will not play it', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      MockAudio.failPlay = true
      const error = console.error
      console.error = () => {}
      await controller.play()
      console.error = error
      expect(controller.loadFailed).to.equal(true)
      expect(controller.isPlaying).to.equal(false)
    })
  })

  describe('stopping', () => {
    it('fades out to silence, then pauses', async () => {
      const controller = await playing()
      const gain = context.gains[0]
      const stopped = controller.stop()

      await clock.tick(FADE / 2)
      expect(gain.gain.value).to.be.closeTo(VOLUME * 0.25, 0.001)
      expect(audios[0].paused).to.equal(false)

      await clock.tick(FADE / 2)
      await stopped
      expect(gain.gain.value).to.equal(0)
      expect(audios[0].paused).to.equal(true)
      expect(controller.isPlaying).to.equal(false)
    })

    it('starts from where a fade in had got to, with no jump', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      await controller.play()
      await clock.tick(FADE / 2)
      const gain = context.gains[0]
      const reached = gain.gain.value

      const stopped = controller.stop()
      await clock.tick(10)
      expect(gain.gain.value).to.be.lessThan(reached)
      expect(gain.gain.value).to.be.greaterThan(reached * 0.9)
      await clock.tick(FADE)
      await stopped
      expect(gain.gain.value).to.equal(0)
    })

    it('does nothing when no pad was ever loaded', async () => {
      const controller = make()
      await controller.stop()
      expect(controller.isPlaying).to.equal(false)
    })
  })

  describe('volume', () => {
    it('changes a pad that has finished fading in at once', async () => {
      const controller = await playing()
      controller.setVolume(0.3)
      expect(context.gains[0].gain.value).to.equal(0.3)
    })

    it('leaves a fade to finish at the new volume', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      await controller.play()
      await clock.tick(FADE / 2)
      const before = context.gains[0].gain.value
      controller.setVolume(0.3)
      expect(context.gains[0].gain.value).to.equal(before)
      await clock.tick(FADE / 2)
      expect(context.gains[0].gain.value).to.equal(0.3)
    })
  })

  describe('changing key', () => {
    it('crossfades: the old pad out as the new one comes in, then stops the old', async () => {
      const controller = await playing()
      const [oldGain] = context.gains
      const [oldAudio] = audios

      await controller.crossfadeTo('G', PADS)
      expect(controller.currentKey).to.equal('G')
      expect(audios).to.have.length(2)
      expect(audios[1].src).to.include('/pad-sets/pads/G.mp3')
      expect(audios[1].paused).to.equal(false)
      const newGain = context.gains[1]

      await clock.tick(1000)
      expect(oldGain.gain.value).to.be.closeTo(VOLUME * 0.5, 0.001)
      expect(newGain.gain.value).to.be.closeTo(VOLUME * 0.5, 0.001)
      expect(oldAudio.paused).to.equal(false)

      await clock.tick(1000)
      expect(oldGain.gain.value).to.equal(0)
      expect(newGain.gain.value).to.equal(VOLUME)
      expect(oldAudio.paused).to.equal(true)
      expect(oldAudio.hasListener('error')).to.equal(false)
      expect(controller.isPlaying).to.equal(true)
    })

    it('fades the old pad out, and says so, when the new key has no pad', async () => {
      const controller = await playing()
      const [oldGain] = context.gains
      const fading = controller.crossfadeTo('xyz', PADS)
      await clock.tick(FADE)
      await fading
      expect(controller.loadFailed).to.equal(true)
      expect(controller.currentKey).to.equal('C')
      expect(oldGain.gain.value).to.equal(0)
      expect(audios[0].paused).to.equal(true)
      expect(audios).to.have.length(1)
    })

    it('fades the old pad out when the new one will not play', async () => {
      const controller = await playing()
      const [oldGain] = context.gains
      MockAudio.failPlay = true
      const error = console.error
      console.error = () => {}
      const fading = controller.crossfadeTo('G', PADS)
      // (the pad is found in the cache, which the fake clock does not move)
      await new Promise(resolve => realSetTimeout(resolve, 20))
      await clock.tick(FADE)
      await fading
      console.error = error
      expect(controller.loadFailed).to.equal(true)
      expect(oldGain.gain.value).to.equal(0)
    })
  })

  describe('stereo routing', () => {
    const gainOf = (i = 0) => context.gains[i]

    it('goes straight to the output by default', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      expect(gainOf().connections).to.deep.equal([
        { to: context.destination, output: undefined, input: undefined },
      ])
    })

    it('sends a pad to the left channel only', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      controller.setStereoMode('left')
      const [splitter] = context.splitters
      const [merger] = context.mergers
      expect(gainOf().connections.map(c => c.to)).to.deep.equal([splitter])
      expect(splitter.connections).to.deep.equal([{ to: merger, output: 0, input: 0 }])
      expect(merger.connections.map(c => c.to)).to.deep.equal([context.destination])
    })

    it('sends a pad to the right channel only', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      controller.setStereoMode('right')
      expect(context.splitters[0].connections).to.deep.equal([
        { to: context.mergers[0], output: 0, input: 1 },
      ])
    })

    it('goes back to both channels, and lets go of the extra nodes', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      controller.setStereoMode('left')
      controller.setStereoMode('both')
      expect(gainOf().connections.map(c => c.to)).to.deep.equal([context.destination])
      expect(context.splitters[0].connections).to.deep.equal([])
      expect(context.mergers[0].connections).to.deep.equal([])
    })

    it('ignores a mode it does not know', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      controller.setStereoMode('sideways' as 'left')
      expect(context.splitters).to.have.length(0)
      expect(gainOf().connections.map(c => c.to)).to.deep.equal([context.destination])
    })

    it('keeps the mode for the pad a crossfade brings in', async () => {
      const controller = await playing()
      controller.setStereoMode('right')
      await controller.crossfadeTo('G', PADS)
      expect(context.gains[1].connections[0].to).to.be.instanceOf(MockSplitter)
    })
  })

  describe('when the audio fails', () => {
    it('goes silent, stops and marks the load as failed', async () => {
      const controller = await playing()
      audios[0].fire('error')
      expect(controller.loadFailed).to.equal(true)
      expect(context.gains[0].gain.value).to.equal(0)
      expect(audios[0].paused).to.equal(true)
    })

    it('ends a fade that was under way', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      await controller.play()
      await clock.tick(FADE / 2)
      audios[0].fire('error')
      expect(context.gains[0].gain.value).to.equal(0)
    })
  })

  describe('cleaning up', () => {
    it('stops a fade, pauses, and lets go of the nodes', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      await controller.play()
      await clock.tick(FADE / 2)
      const gain = context.gains[0]
      const level = gain.gain.value

      expect(clock.pending).to.equal(1)
      controller.cleanup()
      expect(clock.pending, 'timers left running').to.equal(0)
      await clock.tick(FADE)
      expect(gain.gain.value).to.equal(level)
      expect(audios[0].paused).to.equal(true)
      expect(audios[0].hasListener('error')).to.equal(false)
      expect(gain.connections).to.deep.equal([])
    })

    it('cannot load a pad afterwards', async () => {
      const controller = make()
      controller.cleanup()
      let failed = false
      await controller.loadPad('C', PADS).catch(() => {
        failed = true
      })
      expect(failed).to.equal(true)
    })
  })

  describe('what is not as expected', () => {
    it('keeps the stereo mode for when there is something to route', () => {
      const controller = make()
      expect(() => controller.setStereoMode('left')).to.not.throw()
    })

    it('has no URL for no key', async () => {
      expect(await make()._resolvePadUrl(null, null)).to.equal(null)
    })

    it('fades nothing in or out when there is no pad loaded', async () => {
      const controller = make()
      await controller._fadeIn()
      await controller._fadeOut()
      await controller._fadeOutPadGain(null, null)
      expect(clock.pending).to.equal(0)
    })

    it('lets go of the stereo nodes when cleaned up in a stereo mode', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      controller.setStereoMode('right')
      const [splitter] = context.splitters
      const [merger] = context.mergers
      controller.cleanup()
      expect(splitter.connections).to.deep.equal([])
      expect(merger.connections).to.deep.equal([])
    })

    it('waits for the playing event of audio that has not got going', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      audios[0].play = async () => {
        audios[0].paused = false
      }
      const started = controller.play()
      await clock.tick(0)
      audios[0].fire('playing')
      await started
      expect(audios[0].hasListener('playing')).to.equal(false)
    })

    it('starts a fade in again, ending the one under way, when played twice', async () => {
      const controller = make()
      await controller.loadPad('C', PADS)
      await controller.play()
      await clock.tick(FADE / 2)
      await controller.play()
      expect(clock.pending).to.equal(1)
      await clock.tick(FADE)
      expect(context.gains[0].gain.value).to.equal(0.7)
    })

    it('names the pad that would not load by whichever of its sources it has', () => {
      const controller = make()
      const warn = console.warn
      const warned: unknown[][] = []
      console.warn = (...args) => warned.push(args)
      try {
        controller._handleAudioError({
          target: { currentSrc: 'a.mp3', src: 'b.mp3', paused: true },
        } as never)
        controller._handleAudioError({ target: { src: 'b.mp3', paused: true } } as never)
        controller._handleAudioError({ error: 'broken' } as never)
        controller._handleAudioError(undefined as never)
      } finally {
        console.warn = warn
      }
      expect(warned.map(args => args[1])).to.deep.equal([
        'a.mp3',
        'b.mp3',
        'unknown source',
        'unknown source',
      ])
      expect(warned[2][2]).to.equal('broken')
    })

    it('carries on when audio that failed will not pause', () => {
      const controller = make()
      const debug = console.debug
      const logged: unknown[][] = []
      console.debug = (...args) => logged.push(args)
      try {
        controller._handleAudioError({
          target: {
            paused: false,
            pause() {
              throw new Error('cannot')
            },
          },
        } as never)
      } finally {
        console.debug = debug
      }
      expect(controller.loadFailed).to.equal(true)
      expect(logged).to.have.length(1)
    })
  })
})
