/**
 * The choices of "What do you play?" (docs/PERSONAL_LAYER.md, "How I play it"), as the first-use setup
 * and Preferences ask it. A type is a preset of what is switched on; `custom` leaves each to the person.
 */

import type { MusicianType } from './preferences.ts'
import { t } from './text.ts'

export interface PlayOption {
  type: MusicianType
  label: string
  description: string
}

export const PLAYS: readonly PlayOption[] = [
  {
    type: 'singer',
    get label() {
      return t('play-singer')
    },
    get description() {
      return t('play-singer-description')
    },
  },
  {
    type: 'guitarist',
    get label() {
      return t('play-guitarist')
    },
    get description() {
      return t('play-guitarist-description')
    },
  },
  {
    type: 'transposing',
    get label() {
      return t('play-transposing')
    },
    get description() {
      return t('play-transposing-description')
    },
  },
  {
    type: 'general',
    get label() {
      return t('play-general')
    },
    get description() {
      return t('play-general-description')
    },
  },
  {
    type: 'custom',
    get label() {
      return t('play-custom')
    },
    get description() {
      return t('play-custom-description')
    },
  },
]
