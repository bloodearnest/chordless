/**
 * Whether a new version of the app is ready, and the way to take it.
 *
 * The browser checks for a new service worker itself when the app is opened, but an installed
 * app is rarely closed, and coming back to it is not an opening: so it also checks when the
 * app returns to the foreground, and now and then while it is open. A new worker installs
 * its own copy of the files and then waits (see the install step of service-worker.ts), so a
 * page keeps the version it started with until the user chooses to reload: nothing changes
 * under a setlist that is being played.
 *
 * It is told to the page as `AppUpdateChangeEvent` on window, and shown by the menu button's
 * dot and the menu's first item.
 */

/** Whether a new version is ready changed (sent on window) */
export class AppUpdateChangeEvent extends Event {
  static readonly type = 'app-update:change'
  readonly ready: boolean
  constructor(ready: boolean) {
    super(AppUpdateChangeEvent.type)
    this.ready = ready
  }
}

/** The parts of ServiceWorkerContainer used here (a test gives its own) */
export interface UpdateContainer extends EventTarget {
  readonly controller: ServiceWorker | null
  getRegistration(): Promise<ServiceWorkerRegistration | undefined>
}

/** How soon after a check another is made when the app comes to the foreground */
const MIN_CHECK_GAP_MS = 10 * 60 * 1000
/** How often it checks while open */
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000

export class AppUpdate {
  #container: UpdateContainer | undefined
  #reload: () => void
  #now: () => number
  #registration: ServiceWorkerRegistration | undefined
  #ready = false
  #applying = false
  #lastCheck = 0
  #timer: ReturnType<typeof setInterval> | undefined

  constructor(
    container: UpdateContainer | undefined = navigator.serviceWorker,
    // biome-ignore lint/plugin: a new version has to be loaded afresh: the page's own files are the old version's
    reload: () => void = () => location.reload(),
    now: () => number = Date.now
  ) {
    this.#container = container
    this.#reload = reload
    this.#now = now
  }

  /** Whether a new version is installed and waiting */
  get ready(): boolean {
    return this.#ready
  }

  async start(): Promise<void> {
    const container = this.#container
    if (!container) return
    const registration = await container.getRegistration()
    if (!registration) return
    this.#registration = registration

    // One already waiting (found on opening the app), or one that installs while it is open
    if (registration.waiting && container.controller) this.#set(true)
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing
      worker?.addEventListener('statechange', () => {
        // With no controller this is the first install, which is not an update
        if (worker.state === 'installed' && container.controller) this.#set(true)
      })
    })

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.check()
    })
    this.#timer = setInterval(() => void this.check({ force: true }), CHECK_EVERY_MS)
  }

  stop(): void {
    clearInterval(this.#timer)
  }

  /** Look for a new version now (not again within ten minutes, unless forced) */
  async check({ force = false } = {}): Promise<void> {
    const registration = this.#registration
    if (!registration || this.#ready) return
    if (!force && this.#now() - this.#lastCheck < MIN_CHECK_GAP_MS) return
    this.#lastCheck = this.#now()
    try {
      await registration.update()
    } catch {
      // Offline, or the server is not answering: try again later
    }
  }

  /** Take the new version: the waiting worker takes over, and the page reloads under it */
  apply(): void {
    const waiting = this.#registration?.waiting
    if (this.#applying) return
    this.#applying = true
    if (!waiting || !this.#container) {
      this.#reload()
      return
    }
    this.#container.addEventListener('controllerchange', () => this.#reload(), { once: true })
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  #set(ready: boolean): void {
    if (ready === this.#ready) return
    this.#ready = ready
    window.dispatchEvent(new AppUpdateChangeEvent(ready))
  }
}

export const appUpdate = new AppUpdate()

declare global {
  interface GlobalEventHandlersEventMap {
    [AppUpdateChangeEvent.type]: AppUpdateChangeEvent
  }
}
