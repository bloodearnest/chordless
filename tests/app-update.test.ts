import { expect } from '@open-wc/testing'
import { AppUpdate, AppUpdateChangeEvent, type UpdateContainer } from '../src/js/app-update.ts'
import { must } from './must.ts'
import { settle } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

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

  it('tells the page once it has found the worker to ask, which a page shown before it cannot know', async () => {
    await start()
    expect(update.available).to.equal(true)
    expect(changes).to.deep.equal([false])
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

  it('notes when it last looked, and whether it could reach the server', async () => {
    await start()
    expect(update.lastChecked).to.equal(null)
    expect(update.available).to.equal(true)

    await update.check({ force: true })
    expect(update.lastChecked).to.equal(clock)
    expect(update.failed).to.equal(false)

    clock += 5_000
    must(container.registration).failUpdate = true
    await update.check({ force: true })
    expect(update.failed).to.equal(true)
    expect(update.lastChecked).to.equal(clock)
    expect(update.checking).to.equal(false)
  })

  it('says a check is under way while it is', async () => {
    await start()
    const seen: boolean[] = []
    const watch = () => seen.push(update.checking)
    window.addEventListener(AppUpdateChangeEvent.type, watch)
    await update.check({ force: true })
    window.removeEventListener(AppUpdateChangeEvent.type, watch)
    expect(seen).to.deep.equal([true, false])
  })

  it('says a new version is being saved from when it is found until it is installed', async () => {
    await start()
    const worker = new FakeWorker()
    must(container.registration).installing = worker
    must(container.registration).dispatchEvent(new Event('updatefound'))
    expect(update.installing).to.equal(true)
    expect(update.ready).to.equal(false)
    worker.state = 'installed'
    worker.dispatchEvent(new Event('statechange'))
    expect(update.installing).to.equal(false)
    expect(update.ready).to.equal(true)
  })

  it('asks the worker which version is running', async () => {
    const answers = new FakeWorker()
    answers.postMessage = (message: unknown, transfer?: Transferable[]) => {
      const port = transfer?.[0] as MessagePort
      expect((message as { type: string }).type).to.equal('GET_VERSION')
      port.postMessage({ version: 'abc123def456', released: '2026-10-12T17:58:00+01:00' })
    }
    container.controller = answers
    await start()
    expect(await update.runningVersion()).to.deep.equal({
      version: 'abc123def456',
      released: '2026-10-12T17:58:00+01:00',
    })

    container.controller = null
    expect(await update.runningVersion()).to.equal(null)
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

  it('reloads straight away when told to apply an update that has no waiting worker', async () => {
    await start()
    update.apply()
    expect(reloads).to.equal(1)
  })

  it('does nothing without a service worker container to start from', async () => {
    update = new AppUpdate(
      null as unknown as UpdateContainer,
      () => reloads++,
      () => clock
    )
    await update.start()
    expect(update.ready).to.equal(false)
    expect(await update.runningVersion()).to.equal(null)
  })

  it('stays ready when a second new version arrives while one is waiting', async () => {
    must(container.registration).waiting = new FakeWorker()
    await start()
    const worker = new FakeWorker()
    must(container.registration).installing = worker
    must(container.registration).dispatchEvent(new Event('updatefound'))
    worker.state = 'installed'
    worker.dispatchEvent(new Event('statechange'))
    expect(update.ready).to.equal(true)
  })

  it('has no version to give when the worker does not say one, and no release date if it has none', async () => {
    const reply = (data: object) => {
      const worker = new FakeWorker()
      worker.postMessage = (_message: unknown, transfer?: Transferable[]) =>
        (transfer as MessagePort[])[0].postMessage(data)
      return worker
    }
    container.controller = reply({})
    await start()
    expect(await update.runningVersion()).to.equal(null)

    container.controller = reply({ version: 'abc123' })
    expect(await update.runningVersion()).to.deep.equal({ version: 'abc123', released: '' })
  })
})
