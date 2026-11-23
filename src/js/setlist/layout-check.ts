/**
 * Does the setlist's layout agree with itself after the screen was turned? An iPad on iOS 17 was
 * seen, after a rotation, with the header's round buttons wider than they are tall, and a swipe
 * between songs stopping half way: the songs were not as wide as the row that scrolls them, so the
 * snap points were not where the songs are. Nothing in our CSS can do that (the buttons are a
 * 2.5rem square, the songs `width: 100%` of the row), so it is the browser laying out with a
 * stale width, and it did not put itself right until the person swiped back.
 *
 * After a resize that has settled (and once more late, as iOS settles late) this reads the
 * layout, reports what it found (`chordless.layout.check`, docs/OBSERVABILITY.md: few spans, as
 * a turn of the screen is rare), and puts the row back on the nearest song if it is stopped
 * between two. It cannot put the buttons right; it says whether they still are.
 */
import { recordSpan } from '../telemetry/telemetry.ts'

/** Pixels the numbers may differ by before they are said to disagree (fractions of a pixel are layout's rounding) */
const TOLERANCE = 1.5
/** How far from square a button may be: a hairline of border rounding, not a stretched circle */
const SQUARE = 0.05
/** Checks reported in one page load: a person turning the screen back and forth is one problem */
const MAX_REPORTS = 12
/** After the last resize: when it has settled, and when iOS has really settled */
const SETTLE_MS = [400, 1500] as const

export interface LayoutReading {
  /** The layout viewport's width: `innerWidth` and the document element's, which agree unless the page is wider than the screen */
  innerWidth: number
  clientWidth: number
  /** The visual viewport's, where the browser has one */
  visualWidth: number | null
  /** How wide the row of songs is, and how wide its first song is */
  containerWidth: number
  sectionWidth: number
  /** How far the row is scrolled from the nearest song's start (0 when it is stopped on one) */
  snapOffset: number
  /** The most a header button is from square, as the fraction its width is over its height (0: all square) */
  buttonStretch: number
}

/** What does not agree, by the names the reports use */
export function layoutProblems(reading: LayoutReading): string[] {
  const problems: string[] = []
  if (Math.abs(reading.innerWidth - reading.clientWidth) > TOLERANCE) problems.push('viewport')
  if (
    reading.visualWidth !== null &&
    Math.abs(reading.visualWidth - reading.innerWidth) > TOLERANCE
  )
    problems.push('visual_viewport')
  if (Math.abs(reading.sectionWidth - reading.containerWidth) > TOLERANCE)
    problems.push('section_width')
  if (reading.snapOffset > TOLERANCE) problems.push('off_snap')
  if (reading.buttonStretch > SQUARE) problems.push('button_shape')
  return problems
}

const sectionsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(':scope > .section'))

/** Where a song starts along the row's scrolling (not `offsetLeft`, which is from whatever is positioned) */
const startOf = (section: HTMLElement, container: HTMLElement) =>
  section.getBoundingClientRect().left -
  container.getBoundingClientRect().left -
  container.clientLeft +
  container.scrollLeft

/** The song whose start the row is nearest to, and how far from it the row is */
function nearest(container: HTMLElement): { start: number; distance: number } | undefined {
  let best: { start: number; distance: number } | undefined
  for (const section of sectionsOf(container)) {
    const start = startOf(section, container)
    const distance = Math.abs(start - container.scrollLeft)
    if (!best || distance < best.distance) best = { start, distance }
  }
  return best
}

/** Look at the layout; null if the songs are not there (yet) */
export function readLayout(root: HTMLElement, container: HTMLElement): LayoutReading | null {
  const first = sectionsOf(container)[0]
  const target = nearest(container)
  if (!first || !target) return null
  const buttons = [
    ...(root.querySelector('app-header')?.shadowRoot?.querySelectorAll('.icon-button') ?? []),
    ...root.querySelectorAll('.share-button, .live-button'),
  ]
  let buttonStretch = 0
  for (const button of buttons) {
    const { width, height } = button.getBoundingClientRect()
    // (one that is not shown has no size: nothing to say of it)
    if (width > 0 && height > 0)
      buttonStretch = Math.max(buttonStretch, Math.abs(width / height - 1))
  }
  return {
    innerWidth: window.innerWidth,
    clientWidth: document.documentElement.clientWidth,
    visualWidth: window.visualViewport?.width ?? null,
    containerWidth: container.clientWidth,
    sectionWidth: first.getBoundingClientRect().width,
    snapOffset: target.distance,
    buttonStretch,
  }
}

/** Put the row on the song it is nearest to; whether it had to move */
export function snapToNearest(container: HTMLElement): boolean {
  const target = nearest(container)
  if (!target || target.distance <= TOLERANCE) return false
  // (instant: the stylesheet's smooth scrolling would animate, and the row is wrong now)
  container.scrollTo({ left: target.start, behavior: 'instant' })
  return true
}

const round = (value: number) => Math.round(value * 10) / 10

export interface LayoutWatch {
  root: HTMLElement
  /** The row of songs (the setlist page makes it as it shows the setlist) */
  container: () => HTMLElement
  signal: AbortSignal
  /** After the last resize, in ms: when it has settled, and late (the tests make these short) */
  delays?: readonly number[]
}

/** Check, report and mend the layout after the screen is turned or resized, until `signal` aborts */
export function watchLayout({ root, container, signal, delays = SETTLE_MS }: LayoutWatch): void {
  let timers: ReturnType<typeof setTimeout>[] = []
  let reports = 0
  /** When the row was last scrolling: a swipe in progress is not stopped between two songs */
  let scrolledAt = 0
  const check = (phase: number) => {
    if (signal.aborted) return
    const row = container()
    const before = readLayout(root, row)
    if (!before) return
    // (a row still scrolling is not stopped between two songs: the browser puts it on one itself
    // after a resize, animated, so what is read of it now is not yet an answer)
    const moving = performance.now() - scrolledAt < 300
    const problems = layoutProblems(before).filter(problem => !(moving && problem === 'off_snap'))
    const healed = !moving && problems.includes('off_snap') ? snapToNearest(row) : false
    const after = healed ? readLayout(root, row) : null
    const still = after ? layoutProblems(after) : problems
    if (++reports > MAX_REPORTS) return
    recordSpan('chordless.layout.check', {
      'chordless.layout.phase': phase === 0 ? 'settled' : 'late',
      'chordless.layout.ok': problems.length === 0,
      'chordless.layout.problems': problems.join(','),
      'chordless.layout.moving': moving,
      'chordless.layout.healed': healed,
      'chordless.layout.still': still.join(','),
      'chordless.layout.orientation': screen.orientation.type,
      'chordless.layout.inner_width': round(before.innerWidth),
      'chordless.layout.client_width': round(before.clientWidth),
      ...(before.visualWidth === null
        ? {}
        : { 'chordless.layout.visual_width': round(before.visualWidth) }),
      'chordless.layout.container_width': round(before.containerWidth),
      'chordless.layout.section_width': round(before.sectionWidth),
      'chordless.layout.snap_offset': round(before.snapOffset),
      'chordless.layout.button_stretch': round(before.buttonStretch * 100) / 100,
    })
  }
  const resized = () => {
    for (const timer of timers) clearTimeout(timer)
    timers = delays.map((ms, phase) => setTimeout(() => check(phase), ms))
  }
  const scrolled = () => {
    scrolledAt = performance.now()
  }
  window.addEventListener('resize', resized, { signal })
  window.addEventListener('orientationchange', resized, { signal })
  // (scroll does not bubble: captured, it is seen from the row)
  window.addEventListener('scroll', scrolled, { signal, capture: true, passive: true })
  signal.addEventListener('abort', () => {
    for (const timer of timers) clearTimeout(timer)
  })
}
