/**
 * The choices of "What do you play?" (docs/PERSONAL_LAYER.md, "How I play it"), as the first-use setup
 * and Preferences ask it. A type is a preset of what is switched on; `custom` leaves each to the person.
 */
import type { MusicianType } from './preferences.ts'

export interface PlayOption {
  type: MusicianType
  label: string
  description: string
}

export const PLAYS: readonly PlayOption[] = [
  {
    type: 'singer',
    label: 'I sing, or play drums',
    description: 'Lyrics only to start, with no chord controls',
  },
  {
    type: 'guitarist',
    label: 'I play guitar',
    description: 'Chords and lyrics, with capo and tuning controls',
  },
  {
    type: 'general',
    label: 'Another instrument',
    description: 'Chords and lyrics, as they are written',
  },
  {
    type: 'custom',
    label: 'Custom',
    description: 'Choose each setting yourself',
  },
]
