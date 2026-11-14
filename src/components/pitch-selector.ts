import {
  normalizePitch,
  PITCHES,
  type PitchId,
  pitchLabel,
  pitchShort,
} from '../js/instrument-pitch.ts'
import { OptionPicker, type PickerOption } from './option-picker.ts'

/** A pitch was chosen: an id, or null to follow the one above (the setlist's, or the device's) */
export class PitchChangeEvent extends Event {
  static readonly type = 'pitch-selector:change'
  readonly pitch: PitchId | null
  constructor(pitch: PitchId | null) {
    super(PitchChangeEvent.type, { bubbles: true, composed: true })
    this.pitch = pitch
  }
}

/**
 * PitchSelector component (docs/PERSONAL_LAYER.md, "How I play it")
 *
 * Shows the instrument pitch for a setlist, or for a song, and in edit mode lets the user choose another,
 * or the one above again. See OptionPicker.
 *
 * Properties:
 * @property {string} value - the pitch of its own (an id), or '' for the one above
 * @property {string} followed - the pitch it follows when it has none: the device's, or the setlist's
 * @property {string} follows - what that is called ("my device", "the setlist")
 *
 * Events:
 * @fires PitchChangeEvent - When a pitch is chosen (null: the one above)
 */
export class PitchSelector extends OptionPicker<string> {
  static override properties = {
    ...OptionPicker.properties,
    value: { type: String },
    followed: { type: String },
    follows: { type: String },
  }

  declare followed: string
  declare follows: string

  constructor() {
    super()
    this.label = 'Instrument'
    this.value = ''
    this.followed = 'concert'
    this.follows = 'my device'
  }

  override _displayValue(): string {
    return pitchShort(this.value === '' ? this.followed : this.value)
  }

  override _changeEvent(value: string): Event {
    return new PitchChangeEvent(value === '' ? null : normalizePitch(value))
  }

  override _options(): PickerOption<string>[] {
    return [
      {
        value: '',
        label: `Same as ${this.follows}`,
        hint: pitchShort(this.followed),
      },
      ...PITCHES.map(each => ({ value: each.id, label: pitchLabel(each.id), hint: '' })),
    ]
  }
}

customElements.define('pitch-selector', PitchSelector)

declare global {
  interface HTMLElementTagNameMap {
    'pitch-selector': PitchSelector
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [PitchChangeEvent.type]: PitchChangeEvent
  }
}
