/**
 * On a phone the header tucks away while a song is scrolled down, and comes back as soon as it is
 * scrolled up (as a browser's address bar does), to leave more of the screen to the lyrics. See
 * docs/MOBILE_UI.md. On a tablet or desktop it never moves.
 */
import type { AppHeader } from '../../components/app-header.ts'

/** How far to scroll one way, in px, before it counts as a direction (a touch's jitter, a bounce) */
const THRESHOLD = 12

/**
 * How long, in ms, the scrolling is left alone after the header moves: the lyrics grow or shrink
 * with it, which can push the page's end under the finger and look like a scroll the other way
 */
const SETTLE = 350

export interface HeaderAutohide {
  header: AppHeader
  /** Where the songs are: the scrolling (vertical in a song, sideways between them) is theirs */
  root: HTMLElement
  /** Whether a song (not the overview) is the page shown */
  songShown: () => boolean
  signal: AbortSignal
}

export function autohideHeader({ header, root, songShown, signal }: HeaderAutohide) {
  const phone = window.matchMedia('(max-width: 47.99rem)')
  const tops = new WeakMap<Element, number>()
  /** How far the page has gone one way since it last went the other */
  let run = 0
  let settlesAt = 0

  const tuck = (tucked: boolean) => {
    if (header.tucked === tucked) return
    // (the header's margin is what takes it out of the way, so it needs to know its height)
    if (tucked) header.style.setProperty('--tuck', `${header.offsetHeight}px`)
    header.tucked = tucked
    settlesAt = performance.now() + SETTLE
    run = 0
  }

  const onScroll = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    // Between songs, or with nothing to hide it for, the header is there
    if (!songShown() || !phone.matches || target.classList.contains('song-container')) {
      run = 0
      tuck(false)
      return
    }
    if (!target.classList.contains('section')) return

    const top = Math.max(0, target.scrollTop)
    const last = tops.get(target) ?? top
    tops.set(target, top)
    if (performance.now() < settlesAt) return
    const change = top - last
    // Going the other way starts the count again
    run = Math.sign(change) === Math.sign(run) ? run + change : change

    if (top <= header.offsetHeight) tuck(false)
    else if (run > THRESHOLD) tuck(true)
    else if (run < -THRESHOLD) tuck(false)
  }

  // (scroll events don't bubble, but they can be caught on the way down)
  root.addEventListener('scroll', onScroll, { capture: true, passive: true, signal })
  // Back to a wider screen: the header is shown again
  phone.addEventListener('change', () => tuck(false), { signal })
  signal.addEventListener('abort', () => tuck(false))
}
