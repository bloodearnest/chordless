/**
 * The tint behind chords (Preferences, "Chord highlight"): a coloured background for the chords
 * only, never the lyrics, which helps some readers with dyslexia or visual stress find them.
 *
 * The choice is kept as a preset's id ('yellow'), a colour of the reader's own ('#ffe08a') or
 * nothing (''). A preset has a pale colour for the light theme and a deep one for the dark; a colour
 * of the reader's own is used in both. Whatever is behind them, the chords stay readable: the
 * text is the theme's chord colour when that has enough contrast on the tint, otherwise the
 * nearest dark or light ink that does.
 */

/** The contrast WCAG asks of text (level AA) */
export const MIN_CONTRAST = 4.5

export interface TintPreset {
  id: string
  label: string
  /** The background in the light theme */
  light: string
  /** The background in the dark theme */
  dark: string
}

export const TINT_PRESETS: readonly TintPreset[] = [
  { id: 'yellow', label: 'Yellow', light: '#fff4a3', dark: '#5c5212' },
  { id: 'cream', label: 'Cream', light: '#fbf1dc', dark: '#4d4330' },
  { id: 'peach', label: 'Peach', light: '#ffe3cc', dark: '#6b4020' },
  { id: 'pink', label: 'Pink', light: '#ffdfe9', dark: '#6a2c44' },
  { id: 'green', label: 'Green', light: '#d8f5d0', dark: '#1f5a2a' },
  { id: 'blue', label: 'Blue', light: '#d6ecff', dark: '#1d4a6e' },
]

const HEX = /^#[0-9a-f]{6}$/i

/** What is kept for a choice: a preset's id, a #rrggbb colour, or '' for no tint */
export function normaliseTint(stored: string | null | undefined): string {
  const value = (stored ?? '').trim().toLowerCase()
  if (HEX.test(value)) return value
  return TINT_PRESETS.some(preset => preset.id === value) ? value : ''
}

function channel(hex: string, at: number): number {
  const value = parseInt(hex.slice(at, at + 2), 16) / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** How light a #rrggbb colour is, 0 (black) to 1 (white) */
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
}

/** WCAG's contrast ratio between two #rrggbb colours, 1 to 21 */
export function contrastRatio(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

/** The colour behind chords in a theme for a choice, or null for none */
export function tintBackground(tint: string, theme: 'light' | 'dark'): string | null {
  const value = normaliseTint(tint)
  if (!value) return null
  if (value.startsWith('#')) return value
  // (normaliseTint left only a preset's id)
  return (TINT_PRESETS.find(candidate => candidate.id === value) as TintPreset)[theme]
}

const DARK_INK = '#0a2a43'
const LIGHT_INK = '#e8f7ff'

/**
 * The chord text on a background: the theme's own chord colour if it reads there, otherwise the
 * first of a dark and a light ink (the one nearer the background's lightness first) that does,
 * otherwise black or white, whichever is better.
 */
export function inkOn(background: string, chordColour: string): string {
  if (HEX.test(chordColour) && contrastRatio(chordColour, background) >= MIN_CONTRAST) {
    return chordColour
  }
  const darkFirst = luminance(background) > 0.18
  const inks = darkFirst ? [DARK_INK, LIGHT_INK] : [LIGHT_INK, DARK_INK]
  for (const ink of inks) {
    if (contrastRatio(ink, background) >= MIN_CONTRAST) return ink
  }
  return contrastRatio('#000000', background) >= contrastRatio('#ffffff', background)
    ? '#000000'
    : '#ffffff'
}

/** What chords look like in a theme: null for no tint */
export function chordColours(
  tint: string,
  theme: 'light' | 'dark',
  chordColour: string
): { background: string; ink: string } | null {
  const background = tintBackground(tint, theme)
  return background ? { background, ink: inkOn(background, chordColour) } : null
}
