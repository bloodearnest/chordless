import { expect } from '@open-wc/testing'
import { FullscreenController, startFullscreen } from '../src/js/fullscreen.ts'
import { LiveChangeEvent } from '../src/js/live.ts'
import { setFullscreenPreference } from '../src/js/preferences.ts'
import { settle } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

const LIVE = { url: '/setlist/a', title: 'A', startedAt: 1 }

describe('FullscreenController', () => {
  let requests: unknown[]
  let exits: number
  let refuse: boolean
  let fullscreenElement: Element | null
  let visibility: 'visible' | 'hidden'
  let enabled: boolean
  let controller: FullscreenController | undefined

  const define = (target: object, name: string, descriptor: PropertyDescriptor) =>
    Object.defineProperty(target, name, { configurable: true, ...descriptor })

  const setLive = (on: boolean) => window.dispatchEvent(new LiveChangeEvent(on ? LIVE : null))
  const setVisibility = (value: 'visible' | 'hidden') => {
    visibility = value
    document.dispatchEvent(new Event('visibilitychange'))
  }

  beforeEach(() => {
    requests = []
    exits = 0
    refuse = false
    fullscreenElement = null
    visibility = 'visible'
    enabled = true
    localStorage.removeItem('fullscreen_while_live')
    localStorage.removeItem('live_state')
    define(document, 'fullscreenEnabled', { get: () => enabled })
    define(document, 'fullscreenElement', { get: () => fullscreenElement })
    define(document, 'visibilityState', { get: () => visibility })
    define(document, 'exitFullscreen', {
      value: async () => {
        exits++
        fullscreenElement = null
      },
    })
    define(document.documentElement, 'requestFullscreen', {
      value: async (options: unknown) => {
        requests.push(options)
        if (refuse) throw new TypeError('not allowed without a gesture')
        fullscreenElement = document.documentElement
      },
    })
    controller = new FullscreenController()
  })

  afterEach(() => {
    controller?.dispose()
    for (const name of ['fullscreenEnabled', 'fullscreenElement', 'visibilityState']) {
      Reflect.deleteProperty(document, name)
    }
    Reflect.deleteProperty(document, 'exitFullscreen')
    Reflect.deleteProperty(document.documentElement, 'requestFullscreen')
    localStorage.removeItem('fullscreen_while_live')
    localStorage.removeItem('live_state')
  })

  const gesture = async (type = 'keydown') => {
    document.dispatchEvent(new Event(type))
    await settle()
  }

  it('is not asked for until live', async () => {
    await settle()
    expect(requests).to.have.length(0)
  })

  it('is asked for at once when going live, and let go when live ends', async () => {
    setLive(true)
    await settle()
    expect(requests).to.deep.equal([{ navigationUI: 'hide' }])
    expect(fullscreenElement).to.equal(document.documentElement)

    setLive(false)
    await settle()
    expect(exits).to.equal(1)
  })

  it('leaves nothing to let go when live ends and it was left already', async () => {
    setLive(true)
    await settle()
    fullscreenElement = null // the user pressed Esc
    setLive(false)
    await settle()
    expect(exits).to.equal(0)
  })

  it('carries on when the browser will not let go', async () => {
    setLive(true)
    await settle()
    define(document, 'exitFullscreen', {
      value: async () => {
        exits++
        throw new TypeError('not in fullscreen')
      },
    })
    setLive(false)
    await settle()
    expect(exits).to.equal(1)
  })

  it('does not fight someone who left it: nothing asks again until they come back or go live', async () => {
    setLive(true)
    await settle()
    fullscreenElement = null
    document.dispatchEvent(new Event('fullscreenchange'))
    await gesture()
    await gesture('pointerup')
    expect(requests).to.have.length(1)
  })

  it('stays out of it when the setting is off, or the browser cannot', async () => {
    setFullscreenPreference(false)
    setLive(true)
    await settle()
    expect(requests).to.have.length(0)

    setFullscreenPreference(true)
    await settle()
    expect(requests).to.have.length(1)
    setLive(false)
    await settle()

    enabled = false
    setLive(true)
    await settle()
    expect(requests).to.have.length(1)
    expect(FullscreenController.supported).to.equal(false)
  })

  it('is asked for when the setting is turned on while live, and let go when it is turned off', async () => {
    setFullscreenPreference(false)
    setLive(true)
    await settle()
    setFullscreenPreference(true)
    await settle()
    expect(requests).to.have.length(1)
    setFullscreenPreference(false)
    await settle()
    expect(exits).to.equal(1)
  })

  it('waits for a gesture when it is refused, and asks once on it', async () => {
    refuse = true
    setLive(true)
    await settle()
    expect(requests).to.have.length(1)

    // Another refusal, to the gesture, is the end of it
    await gesture()
    expect(requests).to.have.length(2)
    await gesture()
    await gesture('touchend')
    expect(requests).to.have.length(2)
  })

  it('takes the next gesture after a refusal', async () => {
    refuse = true
    setLive(true)
    await settle()
    refuse = false
    await gesture('pointerup')
    expect(requests).to.have.length(2)
    expect(fullscreenElement).to.equal(document.documentElement)
    await gesture()
    expect(requests).to.have.length(2)
  })

  it('does not wait twice when asked again before the gesture', async () => {
    refuse = true
    setLive(true)
    setLive(true)
    await settle()
    refuse = false
    await gesture()
    expect(requests.length).to.equal(3)
  })

  it('is asked for again when the page comes back, not while it is hidden', async () => {
    setLive(true)
    await settle()
    fullscreenElement = null // the browser let go when the page was hidden
    setVisibility('hidden')
    await settle()
    expect(requests).to.have.length(1)
    setVisibility('visible')
    await settle()
    expect(requests).to.have.length(2)
  })

  it('does not ask on a gesture while hidden, or while already fullscreen', async () => {
    refuse = true
    setLive(true)
    await settle()
    refuse = false
    setVisibility('hidden')
    await gesture()
    expect(requests).to.have.length(1)

    setVisibility('visible')
    refuse = true
    await settle()
    expect(requests).to.have.length(2)
    fullscreenElement = document.documentElement // the user did it with the system's control
    await gesture()
    expect(requests).to.have.length(2)
  })

  it('does not ask while already fullscreen', async () => {
    fullscreenElement = document.documentElement
    setLive(true)
    await settle()
    expect(requests).to.have.length(0)
  })

  it('asks as soon as it starts when the page opens live', async () => {
    controller?.dispose()
    localStorage.setItem('live_state', JSON.stringify(LIVE))
    controller = new FullscreenController()
    await settle()
    expect(requests).to.have.length(1)
  })

  it('is started by the app, and follows live from then', async () => {
    const started = startFullscreen()
    try {
      setLive(true)
      await settle()
      expect(requests.length).to.be.greaterThan(0)
    } finally {
      started.dispose()
    }
  })

  it('stops listening when disposed', async () => {
    controller?.dispose()
    setLive(true)
    setFullscreenPreference(true)
    await settle()
    expect(requests).to.have.length(0)
  })
})
