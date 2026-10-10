// @ts-nocheck: not typed yet (remove this line when converting)
import { ContextProvider, createContext } from '@lit/context'
import {
  AccidentalsPreferenceEvent,
  getUseNashvilleNumbers,
  getUseUnicodeAccidentals,
  NashvillePreferenceEvent,
} from './preferences.ts'

/**
 * How chords are shown, as a Lit context: {nashville, unicodeAccidentals}.
 *
 * Provided for the whole page from <html> as soon as this module loads, and
 * kept current as the preferences change. Consume it with
 *
 *   new ContextConsumer(this, { context: displayPreferencesContext, subscribe: true })
 *
 * (song-display does, and passes the values down to its sections and chords).
 */
export const displayPreferencesContext = createContext(Symbol('display-preferences'))

function current() {
  return { nashville: getUseNashvilleNumbers(), unicodeAccidentals: getUseUnicodeAccidentals() }
}

const provider = new ContextProvider(document.documentElement, {
  context: displayPreferencesContext,
  initialValue: current(),
})

for (const type of [NashvillePreferenceEvent.type, AccidentalsPreferenceEvent.type]) {
  window.addEventListener(type, () => provider.setValue(current()))
}
