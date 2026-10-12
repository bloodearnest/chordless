import { expect } from '@open-wc/testing'
import { AppUpdate, AppUpdateChangeEvent, type UpdateContainer } from '../src/js/app-update.ts'

const { describe, it, beforeEach, afterEach } = window

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/** A ServiceWorker that records what it is sent, and whose state a test sets */
class FakeWorker extends EventTarget {
  state = 'installing'
  messages: unknown[] = []
  postMessage(message: unknown) {
    this.messages.push(message)
  }
}

/** A ServiceWorkerRegistration with the parts AppUpdate uses */
class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null
  installing: FakeWorker | null = null
  updates = 0
  failUpdate = false
  async update() {
    this.updates++
    if (this.failUpdate) throw new TypeError('Failed to fetch')
  }
}

class FakeContainer extends EventTarget {
  controller: object | null = {}
  registration: FakeRegistration | undefined = new FakeRegistration()
  async getRegistration() {
    return this.registration as unknown as ServiceWorkerRegistration | undefined
  }
}

describe('AppUpdate', () => {
  let container: FakeContainer
  let reloads: number
  let clock: number
  let update: AppUpdate
  let changes: boolean[]
  let visibility: 'visible' | 'hidden'

  const onChange = (event: AppUpdateChangeEvent) => changes.push(event.ready)

  const start = async () => {
    update = new AppUpdate(
      container as unknown as UpdateContainer,
      () => reloads++,
      () => clock
    )
    await update.start()
  }

  const bringToForeground = () => {
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
  }

  beforeEach(() => {
    container = new FakeContainer()
    reloads = 0
    clock = 1_000_000
    changes = []
    visibility = 'hidden'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })
    window.addEventListener(AppUpdateChangeEvent.type, onChange)
  })

  afterEach(() => {
    update?.stop()
    window.removeEventListener(AppUpdateChangeEvent.type, onChange)
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('has nothing ready with no service worker', async () => {
    container.registration = undefined
    await start()
    expect(update.ready).to.equal(false)
  })

  it('is ready when a new version was already waiting as the app opened', async () => {
    must(container.registration).waiting = new FakeWorker()
    await start()
    expect(update.ready).to.equal(true)
    expect(changes).to.deep.equal([true])
  })

  it('is ready when a new version installs while it is open', async () => {
    await start()
    expect(update.ready).to.equal(false)
    const worker = new FakeWorker()
    must(container.registration).installing = worker
    must(container.registration).dispatchEvent(new Event('updatefound'))
    worker.state = 'installing'
    worker.dispatchEvent(new Event('statechange'))
    expect(update.ready).to.equal(false)
    worker.state = 'installed'
    worker.dispatchEvent(new Event('statechange'))
    expect(update.ready).to.equal(true)
  })

  it('does not call the very first install an update', async () => {
    container.controller = null
    await start()
    const worker = new FakeWorker()
    must(container.registration).installing = worker
    must(container.registration).dispatchEvent(new Event('updatefound'))
    worker.state = 'installed'
    worker.dispatchEvent(new Event('statechange'))
    expect(update.ready).to.equal(false)
  })

  it('looks for a new version when the app returns to the foreground, not too often', async () => {
    await start()
    const registration = must(container.registration)
    bringToForeground()
    await settle()
    expect(registration.updates).to.equal(1)

    clock += 60_000
    bringToForeground()
    await settle()
    expect(registration.updates).to.equal(1)

    clock += 11 * 60_000
    bringToForeground()
    await settle()
    expect(registration.updates).to.equal(2)
  })

  it('carries on when the check fails, as when offline', async () => {
    await start()
    must(container.registration).failUpdate = true
    await update.check({ force: true })
    expect(update.ready).to.equal(false)
  })

  it('asks the waiting worker to take over, and reloads once it has', async () => {
    const waiting = new FakeWorker()
    must(container.registration).waiting = waiting
    await start()

    update.apply()
    expect(waiting.messages).to.deep.equal([{ type: 'SKIP_WAITING' }])
    expect(reloads).to.equal(0)

    container.dispatchEvent(new Event('controllerchange'))
    expect(reloads).to.equal(1)

    // A second press does not ask again
    update.apply()
    expect(waiting.messages).to.have.length(1)
  })
})

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('expected a value')
  return value
}
