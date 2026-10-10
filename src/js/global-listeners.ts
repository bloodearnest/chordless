// @ts-nocheck: not typed yet (remove this line when converting)
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
export class GlobalListeners {
  #entries = []
  #abort = null

  /** @param {import('lit').ReactiveControllerHost} host */
  constructor(host) {
    host.addController(this)
  }

  /**
   * Listen on a target while the host is connected. Safe to call before or
   * after the host connects.
   * @param {EventTarget} target
   * @param {string} type
   * @param {EventListener} listener
   * @param {AddEventListenerOptions} [options]
   */
  add(target, type, listener, options = {}) {
    this.#entries.push({ target, type, listener, options })
    if (this.#abort) this.#listen(this.#entries.at(-1))
  }

  hostConnected() {
    this.#abort = new AbortController()
    for (const entry of this.#entries) this.#listen(entry)
  }

  hostDisconnected() {
    this.#abort?.abort()
    this.#abort = null
  }

  #listen({ target, type, listener, options }) {
    target.addEventListener(type, listener, { ...options, signal: this.#abort.signal })
  }
}
