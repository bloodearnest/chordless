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
  #checking = false
  #installing = false
  #failed = false
  #lastChecked: number | null = null
  #timer: ReturnType<typeof setInterval> | undefined

  constructor(
    container: UpdateContainer | undefined = navigator.serviceWorker,
    /* v8 ignore next 2 -- reloading the page would end the test run: tests give their own */
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

  /** Whether a check is under way */
  get checking(): boolean {
    return this.#checking
  }

  /** Whether a new version has been found and is being saved */
  get installing(): boolean {
    return this.#installing
  }

  /** Whether the last check could not reach the server */
  get failed(): boolean {
    return this.#failed
  }

  /** When it last looked (ms), or null if it has not yet */
  get lastChecked(): number | null {
    return this.#lastChecked
  }

  /** Whether there is a service worker to ask (not where the browser has none, or it is not installed yet) */
  get available(): boolean {
    return this.#registration !== undefined
  }

  /**
   * Which version of the app is running, and when it was released (an ISO date, or '' if
   * unknown), asked of the worker that serves it. Null if it can't say.
   */
  async runningVersion(): Promise<{ version: string; released: string } | null> {
    const controller = this.#container?.controller
    if (!controller) return null
    return new Promise(resolve => {
      const channel = new MessageChannel()
      const timer = setTimeout(() => resolve(null), 3000)
      channel.port1.onmessage = (event: MessageEvent<{ version?: string; released?: string }>) => {
        clearTimeout(timer)
        const { version, released } = event.data
        resolve(version ? { version, released: released ?? '' } : null)
      }
      controller.postMessage({ type: 'GET_VERSION', messageId: crypto.randomUUID() }, [
        channel.port2,
      ])
    })
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
      if (container.controller) this.#setInstalling(true)
      worker?.addEventListener('statechange', () => {
        // With no controller this is the first install, which is not an update
        if (worker.state === 'installed' && container.controller) this.#set(true)
        if (worker.state === 'installed' || worker.state === 'redundant') {
          this.#setInstalling(false)
        }
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
    if (!registration || this.#ready || this.#checking) return
    if (!force && this.#now() - this.#lastCheck < MIN_CHECK_GAP_MS) return
    this.#lastCheck = this.#now()
    this.#checking = true
    this.#changed()
    try {
      await registration.update()
      this.#failed = false
    } catch {
      // Offline, or the server is not answering: try again later
      this.#failed = true
    }
    this.#checking = false
    this.#lastChecked = this.#now()
    this.#changed()
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
    this.#changed()
  }

  #setInstalling(installing: boolean): void {
    if (installing === this.#installing) return
    this.#installing = installing
    this.#changed()
  }

  /** Anything shown of this changed (the dot and the menu item read `ready`) */
  #changed(): void {
    window.dispatchEvent(new AppUpdateChangeEvent(this.#ready))
  }
}

export const appUpdate = new AppUpdate()

declare global {
  interface GlobalEventHandlersEventMap {
    [AppUpdateChangeEvent.type]: AppUpdateChangeEvent
  }
}
