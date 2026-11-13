/**
 * The typeface choices (Preferences, "Fonts"): for the chords, the lyrics and the rest of the app
 * (the UI), each on its own. They are the fonts a device already has, so they work offline and
 * cost nothing to load; where one is missing the next in its list is used.
 */

export const FONT_AREAS = ['ui', 'lyrics', 'chords'] as const
export type FontArea = (typeof FONT_AREAS)[number]

export interface FontChoice {
  id: string
  label: string
  /** What it is, for the picker */
  note: string
  /** The CSS font-family; null is the app's own for that area */
  family: string | null
}

export const FONT_CHOICES: readonly FontChoice[] = [
  { id: 'default', label: 'Default', note: "the app's own", family: null },
  {
    id: 'clear',
    label: 'Clear sans',
    note: 'wide, open letters (Verdana, Tahoma)',
    family: "Verdana, Tahoma, 'Trebuchet MS', sans-serif",
  },
  {
    id: 'friendly',
    label: 'Friendly',
    note: 'rounded, easy to tell apart (Comic Sans)',
    family: "'Comic Sans MS', 'Comic Neue', 'Chalkboard SE', 'Marker Felt', sans-serif",
  },
  {
    id: 'humanist',
    label: 'Humanist sans',
    note: 'softer shapes (Calibri, Gill Sans)',
    family: "Calibri, Candara, 'Gill Sans', 'Segoe UI', Optima, sans-serif",
  },
  {
    id: 'serif',
    label: 'Serif',
    note: 'with feet (Georgia)',
    family: "Georgia, 'Iowan Old Style', Cambria, serif",
  },
  {
    id: 'mono',
    label: 'Monospace',
    note: 'every letter the same width',
    family: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Courier New', monospace",
  },
]

/** The id kept for a choice, 'default' for anything that is not one */
export function normaliseFont(stored: string | null | undefined): string {
  return FONT_CHOICES.some(choice => choice.id === stored) ? (stored as string) : 'default'
}

/** The font-family a choice makes, or null to leave the area as the app has it */
export function fontFamily(stored: string | null | undefined): string | null {
  return FONT_CHOICES.find(choice => choice.id === normaliseFont(stored))?.family ?? null
}
