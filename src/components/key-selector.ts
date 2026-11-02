import { noteName, semitonesBetween } from '../js/chart-range.ts'
import { describeRange, type NoteRange, rangeStatus } from '../js/voice-range.ts'
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
 * @property {NoteRange|null} range - The melody's range, if known: each key is then marked as green,
 *   yellow or red by whether the range fits voices in it (docs/RANGE.md), with a mark and words
 * @property {string} rangeKey - The key the range is written in (the chart's own)
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
    range: { attribute: false },
    rangeKey: { type: String, attribute: 'range-key' },
  }

  declare keys: string[]
  declare originalKey: string
  declare range: NoteRange | null
  declare rangeKey: string

  constructor() {
    super()
    this.label = 'Key'
    this.value = '-'
    this.keys = []
    this.originalKey = ''
    this.range = null
    this.rangeKey = ''
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
      const option: PickerOption<string> = {
        value: key,
        label: key === this.originalKey ? `${key}*` : key,
        hint: offset === 0 ? '' : `${offset > 0 ? '+' : '-'}${Math.abs(offset)}`,
      }
      if (this.range && this.rangeKey) {
        // (the range is the chart's, in its own key: each key is a shift from there)
        const shift = semitonesBetween(this.rangeKey, key)
        option.range = describeRange(rangeStatus(this.range, shift))
        // the notes it comes to in this key, to show what the colour means
        option.notes = {
          low: noteName(this.range.low + shift, key),
          high: noteName(this.range.high + shift, key),
        }
      }
      return option
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
