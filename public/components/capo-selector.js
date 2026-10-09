import { transposeKeyName } from '../js/transpose.js'
import { OptionPicker } from './option-picker.js'

/**
 * CapoSelector component
 *
 * Displays the current capo and, in edit mode, lets the user choose 0 to
 * maxValue, each shown with the key the chords are played in at that capo
 * (from referenceKey). See OptionPicker.
 *
 * Properties:
 * @property {string} label - Label text (default: 'Capo')
 * @property {number} value - Current capo
 * @property {number} maxValue - Highest capo offered (at most 11)
 * @property {string} referenceKey - The song's key, to show the key at each capo
 * @property {boolean} editMode - Whether the capo can be changed
 *
 * Events:
 * @fires capo-change - When a new capo is selected (detail: {value: number})
 */
export class CapoSelector extends OptionPicker {
  static properties = {
    ...OptionPicker.properties,
    value: { type: Number },
    maxValue: { type: Number, attribute: 'max-value' },
    referenceKey: { type: String, attribute: 'reference-key' },
  }

  static changeEvent = 'capo-change'

  constructor() {
    super()
    this.label = 'Capo'
    this.value = 0
    this.maxValue = 11
    this.referenceKey = ''
  }

  _displayValue() {
    return Number.isFinite(this.value) ? this.value : 0
  }

  _options() {
    const max = Number(this.maxValue)
    const highest = Number.isFinite(max) && max >= 0 ? Math.min(Math.floor(max), 11) : 11
    return Array.from({ length: highest + 1 }, (_, capo) => ({
      value: capo,
      label: String(capo),
      hint: this._keyAtCapo(capo),
    }))
  }

  /** The key the chords are played in at this capo, or how far down it is */
  _keyAtCapo(capo) {
    if (!this.referenceKey) return capo === 0 ? 'Open' : `Down ${capo}`
    if (capo === 0) return this.referenceKey
    return transposeKeyName(this.referenceKey, -capo) || `Down ${capo}`
  }
}

customElements.define('capo-selector', CapoSelector)
