import type { ReactiveController, ReactiveControllerHost } from 'lit'

/**
 * Listeners on window, document and the like, for as long as a Lit element is
 * connected: added when it connects, and all removed when it disconnects.
 *
 * A reactive controller, so that views (which come and go with the route) do
 * not leak the listeners a page used to keep for its whole life:
 *
 *   #listeners = new GlobalListeners(this)
 *
 *   constructor() {
 *     super()
 *     this.#listeners.add(document, 'keydown', this.#onKeyDown)
 *     this.#listeners.add(window, 'storage', this.#onStorage, { passive: true })
 *   }
 */
interface Entry {
  target: EventTarget
  type: string
  listener: EventListener
  options: AddEventListenerOptions
}

export class GlobalListeners implements ReactiveController {
  #entries: Entry[] = []
  #abort: AbortController | null = null

  constructor(host: ReactiveControllerHost) {
    host.addController(this)
  }

  /**
   * Listen on a target while the host is connected. Safe to call before or
   * after the host connects.
   *
   * The listener is typed by its own event parameter (E), which the caller
   * knows and the target's type name cannot say.
   */
  add<E extends Event>(
    target: EventTarget,
    type: string,
    listener: (event: E) => void,
    options: AddEventListenerOptions = {}
  ) {
    const entry: Entry = { target, type, listener: listener as EventListener, options }
    this.#entries.push(entry)
    if (this.#abort) this.#listen(entry, this.#abort.signal)
  }

  hostConnected() {
    const abort = new AbortController()
    this.#abort = abort
    for (const entry of this.#entries) this.#listen(entry, abort.signal)
  }

  hostDisconnected() {
    this.#abort?.abort()
    this.#abort = null
  }

  #listen({ target, type, listener, options }: Entry, signal: AbortSignal) {
    target.addEventListener(type, listener, { ...options, signal })
  }
}
