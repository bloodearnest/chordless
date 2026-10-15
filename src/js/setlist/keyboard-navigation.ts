/**
 * The keys of a setlist: left and right go to the previous and next song (the overview is before
 * the first song), up and down scroll the one being shown, and Escape leaves edit mode.
 */
import { isInModalDialog, isTypingInField } from '../utils/keyboard.ts'

export interface NavigationKeys {
  /** Where the setlist's elements are */
  root: HTMLElement
  /** Stops listening */
  signal: AbortSignal
  /** The song being shown, -1 for the overview */
  currentIndex: () => number
  songCount: () => number
  goTo: (index: number) => void
  /** How far an arrow key scrolls, in px */
  scrollAmount: number
  /** Escape was pressed: leaves edit mode, if that is where it is. True if it did something */
  onEscape: () => boolean
}

export function listenForNavigationKeys(keys: NavigationKeys) {
  const scrollBy = (top: number) => {
    const index = keys.currentIndex()
    keys.root
      .querySelector<HTMLElement>(index >= 0 ? `#song-${index}` : '#overview')
      ?.scrollBy({ top, behavior: 'smooth' })
  }

  document.addEventListener(
    'keydown',
    event => {
      // Leave keys alone while typing in a field (e.g. the setlist details form),
      // or in a modal, which handles its own keys (Esc closes it)
      if (isTypingInField(event) || isInModalDialog(event)) return

      if (event.key === 'Escape') {
        if (keys.onEscape()) event.preventDefault()
        return
      }

      // Alt+Left/Right and the like are the browser's
      if (event.altKey || event.ctrlKey || event.metaKey) return

      const current = keys.currentIndex()
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault()
          // The previous song, or the overview from the first
          if (current >= 0) keys.goTo(current - 1)
          break
        case 'ArrowRight':
          event.preventDefault()
          // The next song, or the first from the overview
          if (current < keys.songCount() - 1) keys.goTo(current + 1)
          break
        case 'ArrowUp':
          event.preventDefault()
          scrollBy(-keys.scrollAmount)
          break
        case 'ArrowDown':
          event.preventDefault()
          scrollBy(keys.scrollAmount)
          break
      }
    },
    { signal: keys.signal }
  )
}
