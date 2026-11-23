/**
 * How smoothly the page ran, for the setlist session's leave span (docs/OBSERVABILITY.md): the
 * frames that took more than 50 ms, which is what a "laggy" tablet is. Safari has no Long Tasks API,
 * so this counts the time between `requestAnimationFrame` callbacks instead, which any browser has.
 *
 * It does not run all the time (a callback every frame is a battery cost the app has no right to
 * for a whole service): it runs for a window after the page opens, then for a moment after each
 * thing a person does (a scroll, a tap, a key), which is when lag is felt. A frame is only
 * measured against the one before it in the same run, so the very first frame after something
 * starts it is not seen: the figures undercount a little, never overcount. A run that is cut off
 * by the page being hidden is dropped, not counted as a stall.
 */

/** A frame this long (or longer) is a long frame: three at 60 Hz */
export const LONG_FRAME_MS = 50

/** How long a run goes on after it was last asked for */
export const RUN_ON_MS = 1500

export interface FrameStats {
  /** Frames measured */
  frames: number
  /** Frames that took longer than LONG_FRAME_MS */
  long: number
  /** The longest frame, in ms */
  worstMs: number
  /** The time spent in the long frames, in ms */
  longMs: number
}

const none = (): FrameStats => ({ frames: 0, long: 0, worstMs: 0, longMs: 0 })

function add(stats: FrameStats, gap: number): void {
  stats.frames++
  if (gap < LONG_FRAME_MS) return
  stats.long++
  stats.longMs += gap
  stats.worstMs = Math.max(stats.worstMs, gap)
}

export class FrameMonitor {
  /** What happened in the window after `start()` (the page opening) */
  opening: FrameStats = none()
  /** Everything, the window included */
  total: FrameStats = none()
  /** The ms of the opening window, from `start()` */
  readonly #openingMs: number
  #startedAt = 0
  #until = 0
  #last: number | null = null
  #handle: number | null = null
  #stopped = false

  constructor(openingMs: number) {
    this.#openingMs = openingMs
  }

  /** Begin, running for the opening window */
  start(): void {
    this.#startedAt = performance.now()
    this.arm(this.#openingMs)
  }

  /** Make sure it runs for at least `ms` more (a person did something) */
  arm(ms: number = RUN_ON_MS): void {
    if (this.#stopped) return
    this.#until = Math.max(this.#until, performance.now() + ms)
    if (this.#handle === null) {
      this.#last = null
      this.#handle = requestAnimationFrame(this.#frame)
    }
  }

  /** Stop for good, and say what it saw */
  stop(): { opening: FrameStats; total: FrameStats } {
    this.#stopped = true
    if (this.#handle !== null) cancelAnimationFrame(this.#handle)
    this.#handle = null
    return { opening: this.opening, total: this.total }
  }

  #frame = (now: number): void => {
    this.#handle = null
    // (a hidden page gets no frames: what comes after is a restart, not a stall)
    if (document.hidden) this.#last = null
    else {
      if (this.#last !== null) {
        const gap = now - this.#last
        add(this.total, gap)
        if (now - this.#startedAt <= this.#openingMs) add(this.opening, gap)
      }
      this.#last = now
    }
    if (performance.now() < this.#until) this.#handle = requestAnimationFrame(this.#frame)
  }
}

/**
 * When the browser has painted what has been changed so far: a frame callback is run just before
 * the paint, so the timestamp is taken in the one after (the usual way to ask, as nothing says
 * "painted"). Null if no frame came in `timeoutMs` (the page is hidden, which does not make frames).
 */
export function afterPaint(timeoutMs = 5000): Promise<number | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer)
        resolve(performance.now())
      })
    )
  })
}
