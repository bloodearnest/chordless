import { ContextProvider, createContext } from '@lit/context'
import {
  AccidentalsPreferenceEvent,
  CapoPreferenceEvent,
  getCapoPreference,
  getTuningPreference,
  getUseNashvilleNumbers,
  getUseUnicodeAccidentals,
  NashvillePreferenceEvent,
  TuningPreferenceEvent,
} from './preferences.ts'
import type { Tuning } from './tuning.ts'

/**
 * How chords are shown, as a Lit context: {nashville, unicodeAccidentals, tuning}.
 *
 * Provided for the whole page from <html> as soon as this module loads, and
 * kept current as the preferences change. Consume it with
 *
 *   new ContextConsumer(this, { context: displayPreferencesContext, subscribe: true })
 *
 * (song-display does, and passes the values down to its sections and chords).
 */
/** How chords are shown */
export interface DisplayPreferences {
  nashville: boolean
  unicodeAccidentals: boolean
  /** The device's tuning, when the capo and tuning controls are on (else standard): docs/PERSONAL_LAYER.md */
  tuning: Tuning
}

export const displayPreferencesContext = createContext<DisplayPreferences>(
  Symbol('display-preferences')
)

function current(): DisplayPreferences {
  return {
    nashville: getUseNashvilleNumbers(),
    unicodeAccidentals: getUseUnicodeAccidentals(),
    tuning: getCapoPreference() ? getTuningPreference() : 0,
  }
}

const provider = new ContextProvider(document.documentElement, {
  context: displayPreferencesContext,
  initialValue: current(),
})

for (const type of [
  NashvillePreferenceEvent.type,
  AccidentalsPreferenceEvent.type,
  TuningPreferenceEvent.type,
  CapoPreferenceEvent.type,
]) {
  window.addEventListener(type, () => provider.setValue(current()))
}
