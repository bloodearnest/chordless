import { expect } from '@open-wc/testing'
import { setKeepAwakePreference } from '../src/js/preferences.ts'
import { WakeLockController } from '../src/js/wake-lock.ts'

const { describe, it, beforeEach, afterEach } = window

/** A stand-in for a WakeLockSentinel: release() fires 'release', as the real one does */
class FakeLock extends EventTarget {
  released = false
  async release() {
    this.released = true
    this.dispatchEvent(new Event('release'))
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

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
    await controller.check()
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

  it('tries for a lock with no setlist open, and lets it go at once', async () => {
    await controller.check()
    expect(controller.state).to.equal('idle')
    expect(controller.lastTest).to.deep.equal({ ok: true })
    expect(locks).to.have.length(1)
    expect(locks[0].released).to.equal(true)

    refuse = 'NotAllowedError'
    await controller.check()
    expect(controller.lastTest).to.deep.equal({ ok: false, error: 'NotAllowedError' })
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
