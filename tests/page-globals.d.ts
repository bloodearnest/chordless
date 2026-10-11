// What the Playwright tests put on the page's window (inside page.evaluate)
export {}

declare global {
  interface Window {
    sameDocument?: boolean
    playerElement?: Element
    audioContext?: AudioContext | null
    webkitAudioContext?: typeof AudioContext
  }
}
