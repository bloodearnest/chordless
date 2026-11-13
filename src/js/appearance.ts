import { chordColours, normaliseTint } from './chord-tint.ts'
import { FONT_AREAS, type FontArea, fontFamily } from './fonts.ts'
import { AppearancePreferenceEvent, getChordTint, getFontChoice } from './preferences.ts'

/**
 * Puts the reader's chord highlight and font choices on the page, as CSS variables on <html> (which
 * inherit into every component's shadow DOM):
 *
 *   --chord-tint-bg, --chord-tint-ink   set only while a tint is chosen
 *   --font-family-base                  the UI (the app's own unless chosen)
 *   --font-family-lyrics                the lyrics (follows the UI unless chosen)
 *   --font-family-chords                the chords (their own stack unless chosen)
 *
 * The tint depends on the theme, so the theme manager calls this whenever it sets one; a change of
 * choice (Preferences) is heard here and applied at once, with no reload.
 */

const FAMILY_VARIABLES: Record<FontArea, string> = {
  ui: '--font-family-base',
  lyrics: '--font-family-lyrics',
  chords: '--font-family-chords',
}

/** The theme on show: the theme manager sets color-scheme to it */
function shownTheme(root: HTMLElement): 'light' | 'dark' {
  return root.style.colorScheme === 'dark' ? 'dark' : 'light'
}

/** The font variables this has set, so "default" takes off only those (not a family set otherwise) */
const setByChoice = new Set<FontArea>()

export function applyAppearance(): void {
  const root = document.documentElement
  const theme = shownTheme(root)

  const chord = getComputedStyle(root).getPropertyValue('--chord-color').trim()
  const colours = chordColours(normaliseTint(getChordTint()), theme, chord)
  if (colours) {
    root.style.setProperty('--chord-tint-bg', colours.background)
    root.style.setProperty('--chord-tint-ink', colours.ink)
  } else {
    root.style.removeProperty('--chord-tint-bg')
    root.style.removeProperty('--chord-tint-ink')
  }

  for (const area of FONT_AREAS) {
    const family = fontFamily(getFontChoice(area))
    if (family) {
      root.style.setProperty(FAMILY_VARIABLES[area], family)
      setByChoice.add(area)
    } else if (setByChoice.delete(area)) {
      root.style.removeProperty(FAMILY_VARIABLES[area])
    }
  }
}

window.addEventListener(AppearancePreferenceEvent.type, applyAppearance)
