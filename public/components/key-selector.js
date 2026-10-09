import { OptionPicker } from './option-picker.js'

/**
 * KeySelector component
 *
 * Displays the current key and, in edit mode, lets the user choose another,
 * each shown with its offset from the current key; the song's original key is
 * marked with *. See OptionPicker.
 *
 * Properties:
 * @property {string} label - Label text (default: 'Key')
 * @property {string} value - Currently selected key
 * @property {Array<string>} keys - Available keys to select from
 * @property {string} originalKey - Original key of the song (marked with *)
 * @property {boolean} editMode - Whether the key can be changed
 *
 * Events:
 * @fires key-change - When a new key is selected (detail: {value: string})
 */
export class KeySelector extends OptionPicker {
  static properties = {
    ...OptionPicker.properties,
    value: { type: String },
    keys: { type: Array, attribute: false },
    originalKey: { type: String, attribute: 'original-key' },
  }

  static changeEvent = 'key-change'

  constructor() {
    super()
    this.label = 'Key'
    this.value = '-'
    this.keys = []
    this.originalKey = ''
  }

  _displayValue() {
    return this.value || '-'
  }

  _options() {
    const currentIndex = this.keys.indexOf(this.value)
    return this.keys.map((key, index) => {
      const offset = currentIndex === -1 ? 0 : currentIndex - index
      return {
        value: key,
        label: key === this.originalKey ? `${key}*` : key,
        hint: offset === 0 ? '' : `${offset > 0 ? '+' : '-'}${Math.abs(offset)}`,
      }
    })
  }
}

customElements.define('key-selector', KeySelector)
