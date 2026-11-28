/**
 * Which of a setlist's songs are drawn (docs/LAZY_SONGS.md). Every song has its place in the row, as
 * wide as the row, so that the snap points, the observer and the addresses are the same whatever is
 * drawn, but only the songs near the one in view have their chart in them: drawing every song at
 * once took an iPad on iOS 17 three seconds for sixteen songs, and the time grew faster than the
 * setlist (docs/SPEED_TEST.md).
 */

/** How many songs either side of the one in view are drawn: one swipe at a time is made, and the next two are ready */
export const WINDOW_RADIUS = 2

/**
 * How far from the one in view a song is kept once drawn, either side. More than the window, so that
 * going back and forth does not draw a song again and again: a song is taken away when it is two
 * further than the ones that are drawn ahead. A long setlist drawn whole was slow to scroll, and slower
 * to the end of it, which is memory: nothing else is the difference between a song drawn and not.
 */
export const KEEP_RADIUS = 4

/** How long the row must have stopped scrolling before songs are drawn or taken away: a page that is moving is not changed */
export const SCROLL_SETTLE_MS = 150

/**
 * The songs to have drawn while song `current` is in view (-1 for the overview, which is before the
 * first), nearest first, so that the one in view is drawn before the ones it will swipe to.
 */
export function songsToDraw(current: number, count: number, radius = WINDOW_RADIUS): number[] {
  const wanted: number[] = []
  for (let distance = 0; distance <= radius; distance++) {
    for (const index of distance === 0 ? [current] : [current - distance, current + distance]) {
      if (index >= 0 && index < count) wanted.push(index)
    }
  }
  return wanted
}

/**
 * Of the songs that are drawn, the ones to take away while song `current` is in view (-1 for the
 * overview): those further from it than `radius`, the furthest first.
 */
export function songsToDrop(drawn: number[], current: number, radius = KEEP_RADIUS): number[] {
  return drawn
    .filter(index => Math.abs(index - current) > radius)
    .sort((a, b) => Math.abs(b - current) - Math.abs(a - current))
}
