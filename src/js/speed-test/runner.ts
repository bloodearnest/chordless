/**
 * Running the speed test (docs/SPEED_TEST.md): each way of drawing a setlist (variants.ts), at each
 * size, one after another in a stage that is on the screen (what is not painted is not timed).
 * For each: how long until it is drawn, how big the page is, and how smoothly it scrolls.
 */
import { afterPaint } from '../telemetry/frames.ts'
import { syntheticSetlist } from './chart.ts'
import {
  countTree,
  type DrawTimes,
  type FrameSummary,
  scrollDown,
  type TreeCount,
  timeDrawing,
} from './measure.ts'
import { VARIANTS, type VariantId } from './variants.ts'

/** The setlist sizes: a small one, a usual one, and one that is more than a service has */
export const SIZES = [5, 16, 32]

/** How long each is scrolled for */
export const SCROLL_MS = 2500

/** How long to wait for a frame that does not come, before it is said none did (the page is hidden) */
const PAINT_TIMEOUT_MS = 15_000

export interface RunResult extends DrawTimes, TreeCount {
  variant: VariantId
  songs: number
  scroll: FrameSummary
}

export interface SpeedTestOutcome {
  results: RunResult[]
  /** Stopped before the end */
  stopped: boolean
  /** The page was hidden at some point while it ran (the screen locked, or another app came in front) */
  hidden: boolean
  durationMs: number
}

/** Which timing is under way */
export interface Progress {
  /** How many are finished */
  done: number
  total: number
  variant: VariantId
  songs: number
}

export interface RunOptions {
  signal: AbortSignal
  onProgress(progress: Progress): void
  /** The setlist sizes to time (the usual ones: tests make it small) */
  sizes?: number[]
  /** How long each is scrolled for */
  scrollMs?: number
}

/** How long the page has to show what is next, before it is drawn */
const PROGRESS_SHOWN_MS = 100

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Time everything in `stage`, which the caller has put on the screen, and which scrolls (the
 * songs are put in it, and it is scrolled).
 */
export async function runSpeedTest(
  stage: HTMLElement,
  { signal, onProgress, sizes = SIZES, scrollMs = SCROLL_MS }: RunOptions
): Promise<SpeedTestOutcome> {
  const started = performance.now()
  let hidden = document.hidden
  const onVisibility = () => {
    if (document.hidden) hidden = true
  }
  document.addEventListener('visibilitychange', onVisibility)
  const results: RunResult[] = []
  try {
    // (the first time anything is drawn is slower: a warm-up, not timed, so the first is as the rest)
    const [real] = VARIANTS
    real?.draw(stage, syntheticSetlist(1, { chords: true }))
    await afterPaint(PAINT_TIMEOUT_MS)
    stage.replaceChildren()

    const total = sizes.length * VARIANTS.length
    for (const songs of sizes) {
      for (const variant of VARIANTS) {
        if (signal.aborted) break
        onProgress({ done: results.length, total, variant: variant.id, songs })
        // (the page says what is next before it starts: that drawing is not in the timing)
        await pause(PROGRESS_SHOWN_MS)
        // (stopped, or the page left, while it waited: nothing more is drawn)
        if (signal.aborted) break
        // (made before the clock starts: making the songs is not drawing them)
        const charts = syntheticSetlist(songs, { chords: variant.chords })
        const times = await timeDrawing(stage, () => variant.draw(stage, charts), PAINT_TIMEOUT_MS)
        const tree = countTree(stage)
        const scroll = await scrollDown(stage, scrollMs)
        results.push({ variant: variant.id, songs, ...times, ...tree, scroll })
        stage.replaceChildren()
        // (let what was taken away be cleared before the next is made)
        await pause(100)
      }
    }
  } finally {
    document.removeEventListener('visibilitychange', onVisibility)
    stage.replaceChildren()
  }
  return {
    results,
    stopped: signal.aborted,
    hidden,
    durationMs: performance.now() - started,
  }
}
