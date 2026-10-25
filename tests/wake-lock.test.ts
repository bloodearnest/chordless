import { expect } from '@open-wc/testing'
import { LiveChangeEvent } from '../src/js/live.ts'
import {
  getKeepAwakeMinutes,
  keepAwakeLimitMs,
  setKeepAwakeMinutes,
  setKeepAwakePreference,
} from '../src/js/preferences.ts'
import { WakeLockController } from '../src/js/wake-lock.ts'
import { settle, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

/** A stand-in for a WakeLockSentinel: release() fires 'release', as the real one does */
class FakeLock extends EventTarget {
  released = false
  async release() {
    this.released = true
    this.dispatchEvent(new Event('release'))
  }
}

describe('WakeLockController', () => {
  let locks: FakeLock[]
  let refuse: string | null
  let visibility: 'visible' | 'hidden'
  let controller: WakeLockController

  const setVisibility = (value: 'visible' | 'hidden') => {
    visibility = value
    document.dispatchEvent(new Event('visibilitychange'))
  }

  beforeEach(() => {
    locks = []
    refuse = null
    visibility = 'visible'
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          if (refuse) throw new DOMException('refused', refuse)
          const lock = new FakeLock()
          locks.push(lock)
          return lock
        },
      },
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })
    localStorage.removeItem('keep_screen_awake')
    controller = new WakeLockController()
  })

  afterEach(() => {
    controller.dispose()
    Reflect.deleteProperty(navigator, 'wakeLock')
    Reflect.deleteProperty(document, 'visibilityState')
    localStorage.removeItem('keep_screen_awake')
  })

  it('is idle until a setlist is open, then holds a lock, and lets it go on leaving', async () => {
    expect(controller.state).to.equal('idle')
    controller.hold()
    await settle()
    expect(controller.state).to.equal('active')
    expect(locks).to.have.length(1)

    controller.letGo()
    await settle()
    expect(controller.state).to.equal('idle')
    expect(locks[0].released).to.equal(true)
  })

  it('keeps the lock while any setlist view is still open', async () => {
    controller.hold()
    controller.hold()
    await settle()
    controller.letGo()
    await settle()
    expect(controller.state).to.equal('active')
    expect(locks[0].released).to.equal(false)
    controller.letGo()
    await settle()
    expect(controller.state).to.equal('idle')
  })

  it('notes when the device lets go, and asks again when the page shows', async () => {
    controller.hold()
    await settle()
    // The device lets go, as it does when the page is hidden
    setVisibility('hidden')
    locks[0].dispatchEvent(new Event('release'))
    await settle()
    expect(controller.state).to.equal('released')
    expect(locks).to.have.length(1)

    setVisibility('visible')
    await settle()
    expect(controller.state).to.equal('active')
    expect(locks).to.have.length(2)
  })

  it('waits for the page to be visible', async () => {
    visibility = 'hidden'
    controller.hold()
    await settle()
    expect(locks).to.have.length(0)
    setVisibility('visible')
    await settle()
    expect(controller.state).to.equal('active')
  })

  it('says why the device refused, and holds a lock once it will give one', async () => {
    refuse = 'NotAllowedError'
    controller.hold()
    await settle()
    expect(controller.state).to.equal('failed')
    expect(controller.error).to.equal('NotAllowedError')

    refuse = null
    await controller.requestAgain()
    expect(controller.state).to.equal('active')
    expect(controller.error).to.equal('')
  })

  it('holds none while it is switched off in Preferences, and starts when it is switched on', async () => {
    setKeepAwakePreference(false)
    controller.hold()
    await settle()
    expect(controller.state).to.equal('off')
    expect(locks).to.have.length(0)

    setKeepAwakePreference(true)
    await settle()
    expect(controller.state).to.equal('active')

    setKeepAwakePreference(false)
    await settle()
    expect(controller.state).to.equal('off')
    expect(locks[0].released).to.equal(true)
  })

  describe('while live', () => {
    const live = (on: boolean) =>
      window.dispatchEvent(
        new LiveChangeEvent(on ? { url: '/setlist/a', title: 'A', startedAt: 1 } : null)
      )

    it('holds a lock on any page, until live ends', async () => {
      live(true)
      await settle()
      expect(controller.state).to.equal('active')
      expect(controller.live).to.equal(true)
      // (the app's own controller hears it too, so there may be a second lock)
      expect(locks.length).to.be.greaterThan(0)

      // A setlist opening and closing meanwhile does not drop it
      controller.hold()
      controller.letGo()
      await settle()
      expect(controller.state).to.equal('active')

      live(false)
      await settle()
      expect(controller.state).to.equal('idle')
      expect(controller.live).to.equal(false)
      expect(locks.every(lock => lock.released)).to.equal(true)
    })

    it('is held from the start when the device was live already', async () => {
      localStorage.setItem(
        'live_state',
        JSON.stringify({ url: '/setlist/a', title: 'A', startedAt: 1 })
      )
      const reloaded = new WakeLockController()
      try {
        await settle()
        expect(reloaded.live).to.equal(true)
        expect(reloaded.state).to.equal('active')
      } finally {
        reloaded.dispose()
        localStorage.removeItem('live_state')
      }
    })

    it('keeps to the setting: with the screen setting off it is not held', async () => {
      setKeepAwakePreference(false)
      live(true)
      await settle()
      expect(controller.state).to.equal('off')
      expect(locks.length).to.equal(0)
      live(false)
    })

    it('says why the device refused it', async () => {
      refuse = 'NotAllowedError'
      live(true)
      await settle()
      expect(controller.state).to.equal('failed')
      expect(controller.error).to.equal('NotAllowedError')
      live(false)
    })
  })

  describe('with no one there', () => {
    let idler: WakeLockController
    /** A BatteryManager stand-in, in place of navigator.getBattery: unplugged unless a test says */
    let battery: EventTarget & { charging: boolean }

    const plug = (charging: boolean) => {
      battery.charging = charging
      battery.dispatchEvent(new Event('chargingchange'))
    }

    beforeEach(async () => {
      battery = Object.assign(new EventTarget(), { charging: false })
      Object.defineProperty(navigator, 'getBattery', {
        configurable: true,
        value: async () => battery,
      })
      idler = new WakeLockController(80)
      await settle()
    })
    afterEach(() => {
      idler.dispose()
      Reflect.deleteProperty(navigator, 'getBattery')
    })

    it('lets go after the idle limit, and takes it again at the next touch', async () => {
      idler.hold()
      await settle()
      expect(idler.state).to.equal('active')

      await wait(160)
      expect(idler.state).to.equal('expired')
      expect(locks[0].released).to.equal(true)

      document.dispatchEvent(new Event('pointerdown'))
      await settle()
      expect(idler.state).to.equal('active')
      expect(locks).to.have.length(2)
    })

    it('counts a touch, a key press and a scroll as someone being there', async () => {
      idler.hold()
      await settle()
      // Each comes inside the limit, so the clock starts again each time
      for (const type of ['pointerdown', 'keydown', 'scroll']) {
        await wait(50)
        document.dispatchEvent(new Event(type))
      }
      await wait(50)
      expect(idler.state).to.equal('active')
      expect(locks).to.have.length(1)
    })

    it('is never let go with no limit', async () => {
      const unlimited = new WakeLockController(Number.POSITIVE_INFINITY)
      unlimited.hold()
      await settle()
      await wait(160)
      expect(unlimited.state).to.equal('active')
      unlimited.dispose()
    })

    describe('on mains power', () => {
      it('has no limit while charging, and starts the clock when unplugged', async () => {
        plug(true)
        idler.hold()
        await settle()
        await wait(160)
        expect(idler.onMains).to.equal(true)
        expect(idler.state).to.equal('active')

        plug(false)
        expect(idler.onMains).to.equal(false)
        await wait(40)
        expect(idler.state).to.equal('active')
        await wait(100)
        expect(idler.state).to.equal('expired')
      })

      it('takes it again at once when plugged in after it was let go', async () => {
        idler.hold()
        await settle()
        await wait(160)
        expect(idler.state).to.equal('expired')

        plug(true)
        await settle()
        expect(idler.state).to.equal('active')
      })

      it('applies the limit where asking about the battery is refused', async () => {
        Object.defineProperty(navigator, 'getBattery', {
          configurable: true,
          value: async () => {
            throw new DOMException('blocked', 'NotAllowedError')
          },
        })
        const refused = new WakeLockController(80)
        await settle()
        expect(refused.onMains).to.equal(null)
        refused.dispose()
      })

      it('applies the limit where the device cannot say whether it is charging', async () => {
        // As in a browser with no Battery Status API
        Object.defineProperty(navigator, 'getBattery', { configurable: true, value: undefined })
        const unknown = new WakeLockController(80)
        await settle()
        expect(unknown.onMains).to.equal(null)
        unknown.hold()
        await settle()
        await wait(160)
        expect(unknown.state).to.equal('expired')
        unknown.dispose()
      })
    })

    it('does not take it again at a touch once the setlist is closed', async () => {
      idler.hold()
      await settle()
      await wait(160)
      expect(idler.state).to.equal('expired')
      idler.letGo()
      await settle()
      expect(idler.state).to.equal('idle')
      document.dispatchEvent(new Event('pointerdown'))
      await settle()
      expect(idler.state).to.equal('idle')
      expect(locks).to.have.length(1)
    })
  })

  it('lets a lock go that arrives after it was no longer wanted', async () => {
    let arrive: (lock: FakeLock) => void = () => {}
    const late = new FakeLock()
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: () => new Promise<FakeLock>(resolve => (arrive = resolve)) },
    })
    controller.hold()
    await settle()
    controller.letGo()
    arrive(late)
    await settle()
    expect(late.released).to.equal(true)
    expect(controller.state).to.equal('idle')
  })

  it('carries on, and says so, when a lock will not be let go', async () => {
    const stuck = new FakeLock()
    stuck.release = async () => {
      throw new DOMException('stuck', 'InvalidStateError')
    }
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: async () => stuck },
    })
    const warn = console.warn
    const warnings: unknown[][] = []
    console.warn = (...args) => warnings.push(args)
    try {
      controller.hold()
      await settle()
      expect(controller.state).to.equal('active')
      controller.letGo()
      await settle()
    } finally {
      console.warn = warn
    }
    expect(warnings.some(args => String(args[0]).includes('release failed'))).to.equal(true)
    expect(controller.state).to.equal('idle')
  })

  it("is 'unsupported' where the browser has no wake lock", async () => {
    Object.defineProperty(WakeLockController, 'supported', { configurable: true, get: () => false })
    try {
      const unsupported = new WakeLockController()
      unsupported.hold()
      await settle()
      expect(unsupported.state).to.equal('unsupported')
      expect(locks).to.have.length(0)
      unsupported.dispose()
    } finally {
      Reflect.deleteProperty(WakeLockController, 'supported')
      Object.defineProperty(WakeLockController, 'supported', {
        configurable: true,
        get: () => 'wakeLock' in navigator,
      })
    }
  })
})

describe('the keep-awake limit setting', () => {
  afterEach(() => localStorage.removeItem('keep_awake_minutes'))

  it('is half an hour until chosen, and holds what is chosen', () => {
    expect(getKeepAwakeMinutes()).to.equal(30)
    expect(keepAwakeLimitMs()).to.equal(30 * 60 * 1000)
    setKeepAwakeMinutes(60)
    expect(getKeepAwakeMinutes()).to.equal(60)
    expect(keepAwakeLimitMs()).to.equal(60 * 60 * 1000)
  })

  it('has no limit at 0, and ignores a value that is not on offer', () => {
    setKeepAwakeMinutes(0)
    expect(getKeepAwakeMinutes()).to.equal(0)
    expect(keepAwakeLimitMs()).to.equal(Number.POSITIVE_INFINITY)
    setKeepAwakeMinutes(7)
    expect(getKeepAwakeMinutes()).to.equal(30)
    localStorage.setItem('keep_awake_minutes', 'banana')
    expect(getKeepAwakeMinutes()).to.equal(30)
  })
})
