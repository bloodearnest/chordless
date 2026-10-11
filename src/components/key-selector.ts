import { OptionPicker, type PickerOption } from './option-picker.ts'

/** A different key was chosen; value is the key */
export class KeyChangeEvent extends Event {
  static readonly type = 'key-selector:change'
  readonly value: string
  constructor(value: string) {
    super(KeyChangeEvent.type, { bubbles: true, composed: true })
    this.value = value
  }
}

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
 * @fires KeyChangeEvent - When a new key is selected (value: string)
 */
export class KeySelector extends OptionPicker<string> {
  static override properties = {
    ...OptionPicker.properties,
    value: { type: String },
    keys: { type: Array, attribute: false },
    originalKey: { type: String, attribute: 'original-key' },
  }

  declare keys: string[]
  declare originalKey: string

  constructor() {
    super()
    this.label = 'Key'
    this.value = '-'
    this.keys = []
    this.originalKey = ''
  }

  override _displayValue(): string {
    return this.value || '-'
  }

  override _changeEvent(value: string): Event {
    return new KeyChangeEvent(value)
  }

  override _options(): PickerOption<string>[] {
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

declare global {
  interface HTMLElementTagNameMap {
    'key-selector': KeySelector
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [KeyChangeEvent.type]: KeyChangeEvent
  }
}
