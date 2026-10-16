/**
 * Live mode: "we are performing from this setlist". See docs/LIVE_MODE.md.
 *
 * One record per device, kept in localStorage so it survives reloads and switching apps. It is
 * the URL of the setlist (a path, and a share's key fragment), not a setlist id, because a
 * shared setlist is not in the library. Going live on another setlist replaces it. Nothing ends
 * it but leaveLive(): not a route change, not switching apps, not edit mode.
 */
export interface LiveState {
  /** Where the live setlist is: its path, and a share's fragment */
  url: string
  /** The setlist's name, for the indicator */
  title: string
  startedAt: number
}

/** Live mode was entered, left or moved to another setlist (sent on window) */
export class LiveChangeEvent extends Event {
  static readonly type = 'live:change'
  /** The state now, or null when not live */
  readonly live: LiveState | null
  constructor(live: LiveState | null) {
    super(LiveChangeEvent.type)
    this.live = live
  }
}

const LIVE_KEY = 'live_state'

/** What is stored, if it is a record we wrote: anything else is as if there were none */
function parse(stored: string | null): LiveState | null {
  if (!stored) return null
  try {
    const value = JSON.parse(stored)
    if (
      value &&
      typeof value.url === 'string' &&
      value.url.startsWith('/') &&
      typeof value.title === 'string' &&
      typeof value.startedAt === 'number'
    ) {
      return { url: value.url, title: value.title, startedAt: value.startedAt }
    }
  } catch {
    // Not JSON
  }
  return null
}

/** The live setlist, or null when not live */
export function getLive(): LiveState | null {
  try {
    return parse(localStorage.getItem(LIVE_KEY))
  } catch {
    return null
  }
}

/** Whether this is the live setlist's URL (the path only: a song within it is still it) */
export function isLiveSetlist(live: LiveState | null, path: string): boolean {
  if (!live) return false
  const liveBase = live.url.split('#')[0].replace(/\/song\/\d+$/, '')
  return liveBase === path.replace(/\/song\/\d+$/, '')
}

/** Go live on a setlist, taking over from any other */
export function goLive(url: string, title: string, now = Date.now()): LiveState {
  const live = { url, title, startedAt: now }
  try {
    localStorage.setItem(LIVE_KEY, JSON.stringify(live))
  } catch (error) {
    console.error('Failed to save live mode', error)
  }
  window.dispatchEvent(new LiveChangeEvent(live))
  return live
}

export function leaveLive(): void {
  try {
    localStorage.removeItem(LIVE_KEY)
  } catch (error) {
    console.error('Failed to save live mode', error)
  }
  window.dispatchEvent(new LiveChangeEvent(null))
}

// Another window of this browser going live or leaving: say it here too
window.addEventListener('storage', event => {
  if (event.key === LIVE_KEY || event.key === null) {
    window.dispatchEvent(new LiveChangeEvent(getLive()))
  }
})

declare global {
  interface GlobalEventHandlersEventMap {
    [LiveChangeEvent.type]: LiveChangeEvent
  }
}
