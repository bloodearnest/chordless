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
