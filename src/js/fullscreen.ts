import { getLive, LiveChangeEvent } from './live.ts'
import { FullscreenPreferenceEvent, getFullscreenPreference } from './preferences.ts'

/**
 * Fullscreen while live (see live.ts and docs/LIVE_MODE.md), if the user has not turned that
 * off in Preferences.
 *
 * The browser only grants it to a user gesture, so it is asked for:
 * - at once when going live (that is the tap on "Go live"), or when the setting is turned on;
 * - on the next tap, key press or swipe, if that was refused (a page opened while live, another
 *   window going live), or if the page came back from being hidden, which leaves fullscreen.
 *
 * If the user leaves fullscreen while looking at the page (Esc, the system's own control), it is
 * not asked for again until they come back to the page or go live again: someone who left it
 * meant to. When live ends, or the setting is turned off, it is left.
 */
export class FullscreenController {
  #live = getLive() !== null
  /** Waiting for a gesture to ask on */
  #armed = false

  constructor() {
    window.addEventListener(LiveChangeEvent.type, this.#onLiveChange)
    window.addEventListener(FullscreenPreferenceEvent.type, this.#onPreferenceChange)
    document.addEventListener('visibilitychange', this.#onVisibility)
    // A page opened while live
    this.#enter()
  }

  /** Whether the browser can do it for any element (not on an iPhone) */
  static get supported(): boolean {
    return document.fullscreenEnabled === true
  }

  /** Whether it is wanted now */
  get #wanted(): boolean {
    return this.#live && getFullscreenPreference() && FullscreenController.supported
  }

  dispose(): void {
    window.removeEventListener(LiveChangeEvent.type, this.#onLiveChange)
    window.removeEventListener(FullscreenPreferenceEvent.type, this.#onPreferenceChange)
    document.removeEventListener('visibilitychange', this.#onVisibility)
    this.#disarm()
  }

  #onLiveChange = (event: LiveChangeEvent): void => {
    this.#live = event.live !== null
    this.#sync()
  }

  #onPreferenceChange = (): void => this.#sync()

  /** Going live or turning the setting on asks; the reverse lets go */
  #sync(): void {
    if (this.#wanted) {
      this.#enter()
      return
    }
    this.#disarm()
    if (document.fullscreenElement) void this.#leave()
  }

  async #leave(): Promise<void> {
    try {
      await document.exitFullscreen()
    } catch {
      // Already left
    }
  }

  #onVisibility = (): void => {
    // Coming back leaves nothing to hold on to: the browser dropped fullscreen when hidden
    if (document.visibilityState === 'visible') this.#enter()
  }

  /** Ask now (which works from a tap), else, if `armOnRefusal`, wait for the next gesture */
  #enter(armOnRefusal = true): void {
    if (!this.#wanted || document.visibilityState !== 'visible' || document.fullscreenElement) {
      return
    }
    void this.#request(armOnRefusal)
  }

  async #request(armOnRefusal: boolean): Promise<void> {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      this.#disarm()
    } catch {
      if (armOnRefusal) this.#arm()
    }
  }

  #onGesture = (): void => {
    this.#disarm()
    // Once: a refusal to a gesture is final until the next entry
    this.#enter(false)
  }

  #arm(): void {
    if (this.#armed) return
    this.#armed = true
    // Touch gestures count as activation when they end, not when they start
    for (const type of GESTURES) document.addEventListener(type, this.#onGesture, { capture: true })
  }

  #disarm(): void {
    if (!this.#armed) return
    this.#armed = false
    for (const type of GESTURES) {
      document.removeEventListener(type, this.#onGesture, { capture: true })
    }
  }
}

const GESTURES = ['pointerup', 'touchend', 'keydown'] as const

/** Start following live mode (once, from the app) */
export function startFullscreen(): FullscreenController {
  return new FullscreenController()
}
