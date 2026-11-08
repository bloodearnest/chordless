import { rangeOfMetadata } from '../js/chart-range.ts'
import type { ChartMetadata, MelodyRecord } from '../js/data-types.ts'
import { songMelody } from '../js/melody-analysis.ts'
import { noteName, semitonesBetween } from '../js/pitch.ts'
import { describeRange, type NoteRange, octaveNearGreen, rangeStatus } from '../js/voice-range.ts'
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

  /** Counts the songs asked for by `showRangeOf`, so an answer for an earlier one is dropped */
  #asked = 0

  constructor() {
    super()
    this.label = 'Key'
    this.value = '-'
    this.keys = []
    this.originalKey = ''
    this.range = null
    this.rangeKey = ''
  }

  /**
   * Show a song's range: its chart's (in `chartKey`), or, when the chart has none, its melody's,
   * which `melody` looks up. Asking again, for this song or another, drops an answer still to come.
   */
  showRangeOf(
    metadata: ChartMetadata | undefined,
    chartKey: string,
    melody: () => Promise<MelodyRecord | undefined>
  ): void {
    const asked = ++this.#asked
    this.range = rangeOfMetadata(metadata)
    this.rangeKey = chartKey
    if (this.range) return
    void melody().then(record => {
      const found = songMelody(metadata, record)
      if (found && asked === this.#asked) {
        this.range = found.range
        this.rangeKey = found.rangeKey
      }
    })
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
        // (the range is the chart's, in its own key: each key is a shift from there, in the octave
        // nearest the green range)
        const moved = octaveNearGreen(shifted(this.range, semitonesBetween(this.rangeKey, key)))
        option.range = describeRange(rangeStatus(moved))
        // the notes it comes to in this key, to show what the colour means
        option.notes = { low: noteName(moved.low, key), high: noteName(moved.high, key) }
      }
      return option
    })
  }
}

/** The range moved by a number of semitones */
const shifted = (range: NoteRange, semitones: number): NoteRange => ({
  low: range.low + semitones,
  high: range.high + semitones,
})

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
