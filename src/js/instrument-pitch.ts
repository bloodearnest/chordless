/**
 * The pitch of a transposing instrument (docs/PERSONAL_LAYER.md, "How I play it"): a B♭ horn reads
 * a chart up a whole step, an E♭ up a sixth, an F up a fifth. A device default, one for a setlist that
 * wins over it, and one for a song that wins over both: on the device, never synced.
 */

import { t } from './text.ts'

export type PitchId = 'concert' | 'bb' | 'eb' | 'f'

export interface PitchOption {
  id: PitchId
  label: string
  /** How far up the chords are moved from the song's key */
  semitones: number
}

export const PITCHES: readonly PitchOption[] = [
  {
    id: 'concert',
    get label() {
      return t('pitch-concert')
    },
    semitones: 0,
  },
  {
    id: 'bb',
    get label() {
      return t('pitch-bb')
    },
    semitones: 2,
  },
  {
    id: 'eb',
    get label() {
      return t('pitch-eb')
    },
    semitones: 9,
  },
  {
    id: 'f',
    get label() {
      return t('pitch-f')
    },
    semitones: 7,
  },
]

/** A pitch from whatever was stored: one of the four, and concert pitch for anything else */
export function normalizePitch(value: unknown): PitchId {
  return PITCHES.find(each => each.id === value)?.id ?? 'concert'
}

const optionOf = (value: unknown) => PITCHES.find(each => each.id === value) ?? PITCHES[0]

/** How far up the chords move for a pitch */
export const pitchSemitones = (value: unknown): number => optionOf(value).semitones

/** A pitch in words, for the picker and the header */
export const pitchLabel = (value: unknown): string => optionOf(value).label

/** A pitch as the header says it: "B♭", "E♭", "F" (concert pitch is none) */
export const pitchShort = (value: unknown): string => optionOf(value).label.split(' ')[0]
