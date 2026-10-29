/**
 * On a phone the header tucks away as a song is scrolled down, and comes back as it is scrolled
 * up (as a browser's address bar does), to leave more of the screen to the lyrics. It moves with
 * the finger, the same distance as the page, and stops once it is away or fully back. On a tablet
 * or desktop it never moves.
 *
 * To be smooth it is moved by a transform, which lays nothing out again as it goes: on a phone it
 * floats over the page (the `floating` attribute), and the pages leave room for it at the top
 * with a padding of its height (`--header-height`, used by `.section`), so the text starts just
 * under it and scrolls at the finger's own pace.
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
  /** The header's height, to the fraction of a pixel: a rounded one leaves a hairline of it showing */
  const height = () => header.getBoundingClientRect().height

  const place = (to: number) => {
    const full = height()
    to = Math.min(Math.max(0, to), full)
    if (to === offset) return
    offset = to
    header.style.transform = offset ? `translateY(${-offset}px)` : ''
    header.tucked = offset > 0 && offset >= full
  }

  /** Floats the header over the page on a phone, and leaves room for it; on a wider screen, not */
  const float = () => {
    header.toggleAttribute('floating', phone.matches)
    if (phone.matches) root.style.setProperty('--header-height', `${height()}px`)
    else {
      root.style.removeProperty('--header-height')
      place(0)
    }
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
    const limit = Math.min(top, height())
    place(Math.min(offset + top - last, limit))
  }

  float()
  // (its height changes with the title, which can run to a second row)
  const resized = new ResizeObserver(float)
  resized.observe(header)
  // (scroll events don't bubble, but they can be caught on the way down)
  root.addEventListener('scroll', onScroll, { capture: true, passive: true, signal })
  phone.addEventListener('change', float, { signal })
  signal.addEventListener('abort', () => {
    resized.disconnect()
    place(0)
    header.removeAttribute('floating')
    root.style.removeProperty('--header-height')
  })
}
