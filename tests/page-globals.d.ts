// What the Playwright tests put on the page's window (inside page.evaluate)
import type { SpaceSetlist } from '../src/js/space-data-types.ts'

declare global {
  interface Window {
    d1SpaceServer?: { row: SpaceSetlist; writes: number }
    sameDocument?: boolean
    playerElement?: Element
    audioContext?: AudioContext | null
    webkitAudioContext?: typeof AudioContext
  }
}
