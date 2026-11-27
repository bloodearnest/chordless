/**
 * What the speed test measures (docs/SPEED_TEST.md): how big the page is, when it has drawn, and how
 * smoothly it scrolls. The page's own telemetry (docs/OBSERVABILITY.md) counts elements in the page
 * and each song's shadow root and no deeper; this goes into every shadow root, so a page made of
 * components is counted whole.
 */
import { afterPaint, LONG_FRAME_MS } from '../telemetry/frames.ts'

/** How big a piece of page is */
export interface TreeCount {
  elements: number
  /** Elements that have a shadow root of their own */
  shadowRoots: number
  /** Elements that are Lit components: they render themselves, a little later than they are made */
  components: number
}

/** The element and every one under it, including inside shadow roots */
function visit(root: ParentNode, each: (element: Element) => void): void {
  for (const element of root.querySelectorAll('*')) {
    each(element)
    if (element.shadowRoot) visit(element.shadowRoot, each)
  }
}

const isComponent = (element: Element): element is Element & { updateComplete: Promise<unknown> } =>
  'updateComplete' in element

export function countTree(root: ParentNode): TreeCount {
  const count: TreeCount = { elements: 0, shadowRoots: 0, components: 0 }
  visit(root, element => {
    count.elements++
    if (element.shadowRoot) count.shadowRoots++
    if (isComponent(element)) count.components++
  })
  return count
}

/** How many times to look again for components that rendering has made */
const SETTLE_ROUNDS = 12

/**
 * Wait for every component under `root` to have rendered. Rendering makes more of them (a song its
 * sections, a section its chords), so look again until a look finds none that were not already waited for.
 */
export async function settle(root: ParentNode): Promise<void> {
  const waited = new WeakSet<Element>()
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    const waits: Promise<unknown>[] = []
    visit(root, element => {
      if (waited.has(element) || !isComponent(element)) return
      waited.add(element)
      waits.push(element.updateComplete)
    })
    if (waits.length === 0) return
    await Promise.allSettled(waits)
  }
}

/** What drawing a piece of page cost, in ms from when it was asked for */
export interface DrawTimes {
  /** Just the building of it: what the call itself took before the browser could do anything */
  buildMs: number
  /** Until the browser had painted after it (null: no frame came, as the page was hidden) */
  firstPaintMs: number | null
  /** Until every component had rendered, and the browser had painted after that */
  settledMs: number | null
}

/** Draw something, and time it until it is on the screen */
export async function timeDrawing(
  stage: ParentNode,
  draw: () => void,
  timeoutMs?: number
): Promise<DrawTimes> {
  const start = performance.now()
  draw()
  const buildMs = performance.now() - start
  const first = await afterPaint(timeoutMs)
  await settle(stage)
  const settled = await afterPaint(timeoutMs)
  return {
    buildMs,
    firstPaintMs: first === null ? null : first - start,
    settledMs: settled === null ? null : settled - start,
  }
}

/** How smoothly something ran, from the time between its frames */
export interface FrameSummary {
  frames: number
  /** Frames of LONG_FRAME_MS or more (the same measure as the page's own report) */
  long: number
  worstMs: number
  medianMs: number
  p95Ms: number
}

const percentile = (sorted: number[], fraction: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] as number

/** Summarise the gaps between frames, in ms */
export function summariseFrames(gaps: number[]): FrameSummary {
  if (gaps.length === 0) return { frames: 0, long: 0, worstMs: 0, medianMs: 0, p95Ms: 0 }
  const sorted = [...gaps].sort((a, b) => a - b)
  return {
    frames: gaps.length,
    long: gaps.filter(gap => gap >= LONG_FRAME_MS).length,
    worstMs: sorted[sorted.length - 1] as number,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
  }
}

/** How fast a finger flicks a page: a fast flick is 2000 px a second, a slow one 500 */
const SCROLL_PX_PER_SECOND = 1200

/** How long past its time a scroll waits for a frame before it gives up (the page was hidden) */
const HIDDEN_GIVE_UP_MS = 5000

/**
 * Scroll down at a flick's speed, for `ms` or to the bottom, and say how smoothly the frames came.
 * The position follows the clock, not the frames, so a device that falls behind skips over the page
 * as a flick would, and is not made to take longer. A page that is hidden gets no frames: after
 * `giveUpAfterMs` past its time it ends with the frames it had.
 */
export function scrollDown(
  scroller: HTMLElement,
  ms: number,
  giveUpAfterMs = HIDDEN_GIVE_UP_MS
): Promise<FrameSummary> {
  return new Promise(resolve => {
    const gaps: number[] = []
    const bottom = scroller.scrollHeight - scroller.clientHeight
    scroller.scrollTop = 0
    let began: number | null = null
    let last: number | null = null
    let finished = false
    const finish = (): void => {
      finished = true
      clearTimeout(giveUp)
      resolve(summariseFrames(gaps))
    }
    // (a hidden page gets no frames at all, so something has to end this)
    const giveUp = setTimeout(finish, ms + giveUpAfterMs)
    const frame = (now: number): void => {
      if (finished) return
      began ??= now
      // (the first frame has nothing before it to be measured against, as in frames.ts)
      if (last !== null && !document.hidden) gaps.push(now - last)
      last = now
      const elapsed = now - began
      scroller.scrollTop = Math.min(bottom, (elapsed / 1000) * SCROLL_PX_PER_SECOND)
      if (elapsed < ms && scroller.scrollTop < bottom) requestAnimationFrame(frame)
      else finish()
    }
    requestAnimationFrame(frame)
  })
}
