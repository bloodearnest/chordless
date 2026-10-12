import { getKeepAwakePreference, KeepAwakePreferenceEvent } from './preferences.ts'

/**
 * Keeps the screen awake while a setlist is open, with the Screen Wake Lock API.
 *
 * There is no permission to ask for: the browser grants a lock to a visible page, and refuses
 * it when the device will not (Battery Saver, say). It drops the lock whenever the page is
 * hidden (another app, the screen off), and sometimes when the battery is low, so the lock
 * is asked for again each time the page is visible. It is held only while a setlist is open
 * (see SetlistView), to spare the battery everywhere else, and only if the user has not
 * turned it off in Preferences.
 *
 * Nothing depends on it: a browser without the API gets the 'unsupported' state.
 */
export type WakeLockState =
  /** The browser has no Screen Wake Lock API */
  | 'unsupported'
  /** Switched off in Preferences */
  | 'off'
  /** On, with no setlist open to keep awake */
  | 'idle'
  /** Held now */
  | 'active'
  /** Let go by the device (the page was hidden, the battery low): asked for again when the page shows */
  | 'released'
  /** The browser refused it; `error` says why (e.g. NotAllowedError) */
  | 'failed'

/** The state changed (sent on window) */
export class WakeLockStateEvent extends Event {
  static readonly type = 'wake-lock:state'
  readonly state: WakeLockState
  constructor(state: WakeLockState) {
    super(WakeLockStateEvent.type)
    this.state = state
  }
}

/** What a trial request (see test()) found */
export interface WakeLockTest {
  ok: boolean
  /** The error's name, when it was refused */
  error?: string
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : String(error))

export class WakeLockController {
  /** How many setlist views are open (a new one can start before the old one is gone) */
  #holders = 0
  #sentinel: WakeLockSentinel | null = null
  #requesting = false
  #state: WakeLockState
  #error = ''
  #lastTest: WakeLockTest | null = null

  constructor() {
    this.#state = this.#restingState()
    document.addEventListener('visibilitychange', this.#onVisibility)
    window.addEventListener(KeepAwakePreferenceEvent.type, this.#sync)
  }

  get state(): WakeLockState {
    return this.#state
  }

  /** Why the browser refused, while the state is 'failed' */
  get error(): string {
    return this.#error
  }

  /** What the last test() found, if there has been one */
  get lastTest(): WakeLockTest | null {
    return this.#lastTest
  }

  static get supported(): boolean {
    return 'wakeLock' in navigator
  }

  /** A setlist is open: keep the screen awake until letGo() */
  hold(): void {
    this.#holders++
    void this.#sync()
  }

  /** The setlist is closed */
  letGo(): void {
    this.#holders = Math.max(0, this.#holders - 1)
    void this.#sync()
  }

  /**
   * Try again now, for the button in Preferences. With a setlist open this asks for the lock
   * as it would; with none it asks for one and lets it go at once, to see whether the device
   * would give it.
   */
  async check(): Promise<void> {
    if (!WakeLockController.supported) return
    if (this.#holders > 0 && getKeepAwakePreference()) {
      await this.#acquire()
      return
    }
    try {
      const lock = await navigator.wakeLock.request('screen')
      await lock.release()
      this.#lastTest = { ok: true }
    } catch (error) {
      this.#lastTest = { ok: false, error: errorName(error) }
    }
    this.#emit()
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.#onVisibility)
    window.removeEventListener(KeepAwakePreferenceEvent.type, this.#sync)
    void this.#release()
  }

  /** The state when nothing is held: why not */
  #restingState(): WakeLockState {
    if (!WakeLockController.supported) return 'unsupported'
    if (!getKeepAwakePreference()) return 'off'
    return 'idle'
  }

  #set(state: WakeLockState, error = ''): void {
    if (state === this.#state && error === this.#error) return
    this.#state = state
    this.#error = error
    this.#emit()
  }

  #emit(): void {
    window.dispatchEvent(new WakeLockStateEvent(this.#state))
  }

  #onVisibility = (): void => {
    // The browser let go when the page was hidden (that sets 'released'); ask again on return
    if (document.visibilityState === 'visible') void this.#sync()
  }

  #sync = async (): Promise<void> => {
    const resting = this.#restingState()
    if (resting !== 'idle' || this.#holders === 0) {
      await this.#release()
      this.#set(resting)
      return
    }
    if (document.visibilityState === 'visible' && !this.#sentinel) await this.#acquire()
  }

  async #acquire(): Promise<void> {
    if (this.#requesting) return
    this.#requesting = true
    try {
      const lock = await navigator.wakeLock.request('screen')
      // The setlist may have closed, or the setting changed, while it was being asked for
      if (this.#holders === 0 || this.#restingState() !== 'idle') {
        await lock.release()
        this.#requesting = false
        await this.#sync()
        return
      }
      this.#sentinel = lock
      lock.addEventListener('release', () => {
        // Only when the device let go: our own release() clears #sentinel first
        if (this.#sentinel !== lock) return
        this.#sentinel = null
        this.#set('released')
      })
      this.#set('active')
    } catch (error) {
      this.#set('failed', errorName(error))
    } finally {
      this.#requesting = false
    }
  }

  async #release(): Promise<void> {
    const lock = this.#sentinel
    this.#sentinel = null
    try {
      await lock?.release()
    } catch (error) {
      console.warn('[WakeLock] release failed:', error)
    }
  }
}

export const wakeLock = new WakeLockController()

declare global {
  interface GlobalEventHandlersEventMap {
    [WakeLockStateEvent.type]: WakeLockStateEvent
  }
}
