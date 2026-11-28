/**
 * Whether going from one place in the setlist's row of songs to another is a move to a neighbour or
 * a jump. The row is scroll-snapped and its songs are each as wide as the row, so a move to the next
 * or the last one is one width away, and a smooth scroll shows the song arriving. A smooth scroll over
 * more than that passes every song between, and draws each as it goes: from the overview to the
 * twelfth song, eleven songs on a tablet that can barely draw one, which was seen as a very jerky
 * slide (docs/SPEED_TEST.md). A jump is made at once.
 */

/** More than this many rows' widths is a jump: a neighbour is one, and the rest is for the margin of a snap point that is not quite where the song is */
const NEIGHBOUR_WIDTHS = 1.5

/** Whether the scroll from `from` to `to` (both a distance along the row) is further than a neighbour, in a row `width` wide */
export function isJump(from: number, to: number, width: number): boolean {
  return Math.abs(to - from) > width * NEIGHBOUR_WIDTHS
}
