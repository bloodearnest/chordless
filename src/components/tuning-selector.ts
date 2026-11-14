import { normalizeTuning, TUNINGS, type Tuning, tuningLabel } from '../js/tuning.ts'
import { OptionPicker, type PickerOption } from './option-picker.ts'

/** A tuning was chosen for the setlist: 0, 1 or 2, or null to follow the device's */
export class TuningChangeEvent extends Event {
  static readonly type = 'tuning-selector:change'
  readonly tuning: Tuning | null
  constructor(tuning: Tuning | null) {
    super(TuningChangeEvent.type, { bubbles: true, composed: true })
    this.tuning = tuning
  }
}

/**
 * TuningSelector component (docs/PERSONAL_LAYER.md, "How I play it")
 *
 * Shows how the guitar is tuned for this setlist and, in edit mode, lets the user choose another, or
 * the device's again. See OptionPicker.
 *
 * Properties:
 * @property {string} value - the setlist's own tuning ('0', '1', '2'), or '' for the device's
 * @property {number} deviceTuning - the device's, which is shown when the setlist has none
 *
 * Events:
 * @fires TuningChangeEvent - When a tuning is chosen (null: the device's)
 */
export class TuningSelector extends OptionPicker<string> {
  static override properties = {
    ...OptionPicker.properties,
    value: { type: String },
    deviceTuning: { type: Number, attribute: 'device-tuning' },
  }

  declare deviceTuning: number

  constructor() {
    super()
    this.label = 'Tuning'
    this.value = ''
    this.deviceTuning = 0
  }

  override _displayValue(): string {
    return this.value === '' ? tuningLabel(this.deviceTuning) : tuningLabel(this.value)
  }

  override _changeEvent(value: string): Event {
    return new TuningChangeEvent(value === '' ? null : normalizeTuning(value))
  }

  override _options(): PickerOption<string>[] {
    return [
      { value: '', label: 'Same as my device', hint: tuningLabel(this.deviceTuning) },
      ...TUNINGS.map(each => ({ value: String(each.semitones), label: each.label, hint: '' })),
    ]
  }
}

customElements.define('tuning-selector', TuningSelector)

declare global {
  interface HTMLElementTagNameMap {
    'tuning-selector': TuningSelector
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [TuningChangeEvent.type]: TuningChangeEvent
  }
}
