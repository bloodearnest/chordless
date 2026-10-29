/**
 * On a phone the header tucks away as a song is scrolled down, and comes back as it is scrolled
 * up (as a browser's address bar does), to leave more of the screen to the lyrics. It moves with
 * the finger, the same distance as the page, and stops once it is away or fully back. On a tablet
 * or desktop it never moves.
 *
 * The header goes by a negative top margin, which also moves the page up under it; to keep the
 * text moving at the finger's pace, not twice it, the page gets that much padding on top (the
 * `--tuck` property, used by `.section`) so the text stays where the scrolling puts it.
 */
import type { AppHeader } from '../../components/app-header.ts'

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
  /** How far the header has gone up, in px: 0 shown, its height away */
  let offset = 0

  const place = (to: number) => {
    const height = header.offsetHeight
    to = Math.min(Math.max(0, to), height)
    if (to === offset) return
    offset = to
    header.style.marginTop = offset ? `${-offset}px` : ''
    root.style.setProperty('--tuck', offset ? `${offset}px` : '0px')
    header.tucked = offset > 0 && offset >= height
  }

  const onScroll = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    // Between songs, or with nothing to hide it for, the header is there
    if (!songShown() || !phone.matches || target.classList.contains('song-container')) {
      place(0)
      return
    }
    if (!target.classList.contains('section')) return

    const top = Math.max(0, target.scrollTop)
    const last = tops.get(target) ?? 0
    tops.set(target, top)
    // (never further away than the page is scrolled: at its top the header is all there)
    const limit = Math.min(top, header.offsetHeight)
    place(Math.min(offset + top - last, limit))
  }

  // (scroll events don't bubble, but they can be caught on the way down)
  root.addEventListener('scroll', onScroll, { capture: true, passive: true, signal })
  // Back to a wider screen: the header is shown again
  phone.addEventListener('change', () => place(0), { signal })
  signal.addEventListener('abort', () => place(0))
}
