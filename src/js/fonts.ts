/**
 * The typeface choices (Preferences, "Fonts"): for the chords, the lyrics and the rest of the app
 * (the UI), each on its own. They are the fonts a device already has, so they work offline and
 * cost nothing to load; where one is missing the next in its list is used.
 */

import { t } from './text.ts'

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
  {
    id: 'default',
    get label() {
      return t('font-default')
    },
    get note() {
      return t('font-default-note')
    },
    family: null,
  },
  {
    id: 'clear',
    get label() {
      return t('font-clear')
    },
    get note() {
      return t('font-clear-note')
    },
    family: "Verdana, Tahoma, 'Trebuchet MS', sans-serif",
  },
  {
    id: 'friendly',
    get label() {
      return t('font-friendly')
    },
    get note() {
      return t('font-friendly-note')
    },
    family: "'Comic Sans MS', 'Comic Neue', 'Chalkboard SE', 'Marker Felt', sans-serif",
  },
  {
    id: 'humanist',
    get label() {
      return t('font-humanist')
    },
    get note() {
      return t('font-humanist-note')
    },
    family: "Calibri, Candara, 'Gill Sans', 'Segoe UI', Optima, sans-serif",
  },
  {
    id: 'serif',
    get label() {
      return t('font-serif')
    },
    get note() {
      return t('font-serif-note')
    },
    family: "Georgia, 'Iowan Old Style', Cambria, serif",
  },
  {
    id: 'mono',
    get label() {
      return t('font-mono')
    },
    get note() {
      return t('font-mono-note')
    },
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
