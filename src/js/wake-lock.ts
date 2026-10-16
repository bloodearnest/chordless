import { getLive, LiveChangeEvent } from './live.ts'
import {
  getKeepAwakePreference,
  KeepAwakeLimitEvent,
  KeepAwakePreferenceEvent,
  keepAwakeLimitMs,
} from './preferences.ts'

/**
 * Keeps the screen awake while a setlist is open, or the device is live (see live.ts), with the
 * Screen Wake Lock API.
 *
 * There is no permission to ask for: the browser grants a lock to a visible page, and refuses
 * it when the device will not (Battery Saver, say). It drops the lock whenever the page is
 * hidden (another app, the screen off), and sometimes when the battery is low, so the lock
 * is asked for again each time the page is visible. It is held while a setlist is open (see
 * SetlistView), and on any page while live, if the user has not turned that off in Preferences;
 * never otherwise, to spare the battery.
 *
 * It is also let go after a time with no touch, key press or scroll (an hour unless the user
 * chose another: see keepAwakeLimitMs), so a tablet left on a stand overnight does not stay
 * lit: the next touch takes it again. On mains power there is no limit: the Battery Status API
 * (Chromium only) says when the device is charging, which a device with no battery always is, and where it is not available the limit
 * applies, as the safe guess.
 *
 * Nothing depends on it: a browser without the API gets the 'unsupported' state.
 */
export type WakeLockState =
  /** The browser has no Screen Wake Lock API */
  | 'unsupported'
  /** Switched off in Preferences */
  | 'off'
  /** On, with no setlist open and not live */
  | 'idle'
  /** Held now */
  | 'active'
  /** Let go by the device (the page was hidden, the battery low): asked for again when the page shows */
  | 'released'
  /** The browser refused it; `error` says why (e.g. NotAllowedError) */
  | 'failed'
  /** Let go by the app after the time chosen with no touch: the next touch takes it again */
  | 'expired'

/** The state changed (sent on window) */
export class WakeLockStateEvent extends Event {
  static readonly type = 'wake-lock:state'
  readonly state: WakeLockState
  constructor(state: WakeLockState) {
    super(WakeLockStateEvent.type)
    this.state = state
  }
}

/** What counts as someone being there (on the document, in the capture phase) */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'scroll'] as const

/** The Battery Status API's object (Chromium only; not in TypeScript's DOM types) */
interface BatteryManager extends EventTarget {
  readonly charging: boolean
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : String(error))

export class WakeLockController {
  /** How many setlist views are open (a new one can start before the old one is gone) */
  #holders = 0
  #sentinel: WakeLockSentinel | null = null
  #requesting = false
  #state: WakeLockState
  #error = ''
  /** The device is live: kept awake whatever page this is */
  #live = getLive() !== null

  /** Whether the device is on mains power: unknown (null) where there is no Battery Status API */
  #onMains: boolean | null = null
  #battery: BatteryManager | null = null
  /** A test's own limit, in ms; else the user's setting */
  #idleLimitOverride: number | undefined
  #lastActivity = Date.now()
  #idleTimer: ReturnType<typeof setTimeout> | undefined

  /** @param idleLimit how long to hold it with no activity, in ms (a test sets its own) */
  constructor(idleLimit?: number) {
    this.#idleLimitOverride = idleLimit
    this.#state = this.#restingState()
    document.addEventListener('visibilitychange', this.#onVisibility)
    window.addEventListener(KeepAwakePreferenceEvent.type, this.#sync)
    window.addEventListener(KeepAwakeLimitEvent.type, this.#onLimitChanged)
    window.addEventListener(LiveChangeEvent.type, this.#onLiveChange)
    for (const type of ACTIVITY_EVENTS) {
      document.addEventListener(type, this.#onActivity, { capture: true, passive: true })
    }
    void this.#watchBattery()
    // A page opened while live (a reload, the app opened again) keeps the screen awake at once
    if (this.#live) void this.#sync()
  }

  /** Whether the device is on mains power, when it can tell: there is no idle limit then */
  get onMains(): boolean | null {
    return this.#onMains
  }

  async #watchBattery(): Promise<void> {
    try {
      const battery = await (
        navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }
      ).getBattery?.()
      if (!battery) return
      this.#battery = battery
      this.#onMains = battery.charging
      battery.addEventListener('chargingchange', this.#onChargingChange)
      this.#onChargingChange()
    } catch {
      // No battery information (blocked, or a desktop with none): the limit applies
    }
  }

  #onChargingChange = (): void => {
    // (only listened for once there is a battery)
    const charging = (this.#battery as BatteryManager).charging
    const changed = charging !== this.#onMains
    this.#onMains = charging
    // Unplugging is someone being there: the limit counts from now
    if (changed && charging === false) this.#lastActivity = Date.now()
    this.#emit()
    this.#onLimitChanged()
  }

  get state(): WakeLockState {
    return this.#state
  }

  /** Why the browser refused, while the state is 'failed' */
  get error(): string {
    return this.#error
  }

  /** Whether the device is live, so the screen is kept awake on any page */
  get live(): boolean {
    return this.#live
  }

  static get supported(): boolean {
    return 'wakeLock' in navigator
  }

  /** A setlist is open: keep the screen awake until letGo() */
  hold(): void {
    this.#holders++
    this.#lastActivity = Date.now()
    void this.#sync()
  }

  /** The setlist is closed */
  letGo(): void {
    this.#holders = Math.max(0, this.#holders - 1)
    void this.#sync()
  }

  #onLiveChange = (event: LiveChangeEvent): void => {
    this.#live = event.live !== null
    // Going live is someone being there: the limit counts from now
    if (this.#live) this.#lastActivity = Date.now()
    this.#emit()
    void this.#sync()
  }

  /** Ask again now, after it was let go or refused: for the button in Preferences */
  async requestAgain(): Promise<void> {
    if (!WakeLockController.supported || !this.#wanted()) return
    this.#lastActivity = Date.now()
    await this.#acquire()
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.#onVisibility)
    window.removeEventListener(KeepAwakePreferenceEvent.type, this.#sync)
    window.removeEventListener(KeepAwakeLimitEvent.type, this.#onLimitChanged)
    window.removeEventListener(LiveChangeEvent.type, this.#onLiveChange)
    for (const type of ACTIVITY_EVENTS) {
      document.removeEventListener(type, this.#onActivity, { capture: true })
    }
    this.#battery?.removeEventListener('chargingchange', this.#onChargingChange)
    clearTimeout(this.#idleTimer)
    void this.#release()
  }

  /** Whether it should be held now: a setlist is open or the device is live, and it is on */
  #wanted(): boolean {
    return (this.#live || this.#holders > 0) && getKeepAwakePreference()
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
    // The browser let go when the page was hidden (that sets 'released'); ask again on return,
    // which is someone being there
    if (document.visibilityState === 'visible') {
      this.#lastActivity = Date.now()
      void this.#sync()
    }
  }

  #onActivity = (): void => {
    this.#lastActivity = Date.now()
    // A touch after it was let go for being idle takes it again
    if (this.#state === 'expired') void this.#sync()
  }

  get #idleLimit(): number {
    if (this.#onMains) return Number.POSITIVE_INFINITY
    return this.#idleLimitOverride ?? keepAwakeLimitMs()
  }

  /** A new limit applies to a lock already held (and, once it has passed, to an expired one) */
  #onLimitChanged = (): void => {
    if (this.#sentinel) this.#armIdleTimer()
    else if (this.#state === 'expired' && Date.now() - this.#lastActivity < this.#idleLimit) {
      void this.#sync()
    }
  }

  /** Let go once the idle limit has passed since the last activity, else look again then */
  #armIdleTimer(): void {
    clearTimeout(this.#idleTimer)
    if (this.#idleLimit === Number.POSITIVE_INFINITY) return
    const remaining = this.#idleLimit - (Date.now() - this.#lastActivity)
    this.#idleTimer = setTimeout(() => void this.#onIdleTimer(), Math.max(0, remaining))
  }

  async #onIdleTimer(): Promise<void> {
    if (!this.#sentinel) return
    if (Date.now() - this.#lastActivity < this.#idleLimit) {
      this.#armIdleTimer()
      return
    }
    await this.#release()
    this.#set('expired')
  }

  #sync = async (): Promise<void> => {
    if (!WakeLockController.supported || !this.#wanted()) {
      clearTimeout(this.#idleTimer)
      await this.#release()
      // It may have been asked for while the lock was being let go
      if (WakeLockController.supported && this.#wanted()) return this.#sync()
      this.#set(this.#restingState())
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
      if (!this.#wanted()) {
        await lock.release()
        this.#requesting = false
        await this.#sync()
        return
      }
      this.#sentinel = lock
      this.#armIdleTimer()
      lock.addEventListener('release', () => {
        // Only when the device let go: our own release() clears #sentinel first
        if (this.#sentinel !== lock) return
        this.#sentinel = null
        clearTimeout(this.#idleTimer)
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
