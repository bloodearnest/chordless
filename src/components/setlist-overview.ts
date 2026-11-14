import { html, LitElement } from 'lit'
import type { PitchId } from '../js/instrument-pitch.ts'
import type { Tuning } from '../js/tuning.ts'
import './icon.ts'
import type { PitchChangeEvent } from './pitch-selector.ts'
import type { SongCardBpmChangeEvent, SongCardKeyChangeEvent } from './song-card.ts'
import './pitch-selector.ts'
import type { TuningChangeEvent } from './tuning-selector.ts'
import './tuning-selector.ts'

/** A song's card was clicked; index is its place in the setlist */
export class OverviewSongClickEvent extends Event {
  static readonly type = 'setlist-overview:song-click'
  readonly index: number
  constructor(index: number) {
    super(OverviewSongClickEvent.type, { bubbles: true, composed: true })
    this.index = index
  }
}

/** A song's delete button was pressed */
export class OverviewSongDeleteEvent extends Event {
  static readonly type = 'setlist-overview:song-delete'
  readonly index: number
  constructor(index: number) {
    super(OverviewSongDeleteEvent.type, { bubbles: true, composed: true })
    this.index = index
  }
}

/** A song's key was changed */
export class OverviewSongKeyChangeEvent extends Event {
  static readonly type = 'setlist-overview:song-key-change'
  readonly index: number
  readonly key: string
  constructor(index: number, key: string) {
    super(OverviewSongKeyChangeEvent.type, { bubbles: true, composed: true })
    this.index = index
    this.key = key
  }
}

/** A song's tempo was changed */
export class OverviewSongBpmChangeEvent extends Event {
  static readonly type = 'setlist-overview:song-bpm-change'
  readonly index: number
  readonly bpm: number
  constructor(index: number, bpm: number) {
    super(OverviewSongBpmChangeEvent.type, { bubbles: true, composed: true })
    this.index = index
    this.bpm = bpm
  }
}

/** A tuning was chosen for the setlist (null: the device's again) */
export class OverviewTuningChangeEvent extends Event {
  static readonly type = 'setlist-overview:tuning-change'
  readonly tuning: Tuning | null
  constructor(tuning: Tuning | null) {
    super(OverviewTuningChangeEvent.type, { bubbles: true, composed: true })
    this.tuning = tuning
  }
}

/** An instrument pitch was chosen for the setlist (null: the device's again) */
export class OverviewPitchChangeEvent extends Event {
  static readonly type = 'setlist-overview:pitch-change'
  readonly pitch: PitchId | null
  constructor(pitch: PitchId | null) {
    super(OverviewPitchChangeEvent.type, { bubbles: true, composed: true })
    this.pitch = pitch
  }
}

/** Add Song was pressed */
export class OverviewAddSongEvent extends Event {
  static readonly type = 'setlist-overview:add-song'
  constructor() {
    super(OverviewAddSongEvent.type, { bubbles: true, composed: true })
  }
}

/**
 * SetlistOverview Component
 *
 * Renders the overview list of songs for the setlist page, using song-card
 * components, and exposes events for navigation, deletion, and adding songs.
 */
export class SetlistOverview extends LitElement {
  static override properties = {
    songs: { type: Array, attribute: false },
    editMode: { type: Boolean, attribute: 'edit-mode' },
    showTuning: { type: Boolean, attribute: 'show-tuning' },
    tuning: { attribute: false },
    deviceTuning: { type: Number, attribute: 'device-tuning' },
    showPitch: { type: Boolean, attribute: 'show-pitch' },
    pitch: { attribute: false },
    devicePitch: { attribute: false },
  }

  declare songs: unknown[] /* TYPE */
  declare editMode: boolean
  /**
   * Whether the guitar's tuning for this setlist can be shown (the capo and tuning controls are on):
   * it is, always in edit mode, and out of it only when it is not standard
   */
  declare showTuning: boolean
  /** The setlist's own tuning, or null for the device's */
  declare tuning: Tuning | null
  declare deviceTuning: number
  /** Whether the instrument pitch for this setlist can be shown (the pitch controls are on): in edit mode, or when it is not concert pitch */
  declare showPitch: boolean
  /** The setlist's own instrument pitch, or null for the device's */
  declare pitch: PitchId | null
  declare devicePitch: PitchId

  constructor() {
    super()
    this.songs = []
    this.editMode = false
    this.showTuning = false
    this.tuning = null
    this.deviceTuning = 0
    this.showPitch = false
    this.pitch = null
    this.devicePitch = 'concert'
  }

  // Render into light DOM so existing CSS/selectors keep working
  override createRenderRoot() {
    return this
  }

  override render() {
    return html`
      <div class="setlist-overview">
        ${
          this.showTuning && (this.editMode || (this.tuning ?? this.deviceTuning) !== 0)
            ? html`<div class="overview-tuning">
                <tuning-selector
                  .value=${this.tuning === null ? '' : String(this.tuning)}
                  .deviceTuning=${this.deviceTuning}
                  .editMode=${this.editMode}
                  @tuning-selector:change=${(event: TuningChangeEvent) => {
                    event.stopPropagation()
                    this.dispatchEvent(new OverviewTuningChangeEvent(event.tuning))
                  }}
                ></tuning-selector>
              </div>`
            : ''
        }
        ${
          this.showPitch && (this.editMode || (this.pitch ?? this.devicePitch) !== 'concert')
            ? html`<div class="overview-tuning">
                <pitch-selector
                  .value=${this.pitch ?? ''}
                  .followed=${this.devicePitch}
                  follows="my device"
                  .editMode=${this.editMode}
                  @pitch-selector:change=${(event: PitchChangeEvent) => {
                    event.stopPropagation()
                    this.dispatchEvent(new OverviewPitchChangeEvent(event.pitch))
                  }}
                ></pitch-selector>
              </div>`
            : ''
        }
        <div class="overview-songs">
          ${this.songs.map(
            (song, index) => html`
              <song-card
                class="overview-song-card"
                data-song-index=${index}
                .song=${song}
                variant="setlist"
                .editMode=${this.editMode}
                @song-card:click=${() => this._handleSongClick(index)}
                @song-card:delete=${() => this._handleSongDelete(index)}
                @song-card:key-change=${(e: SongCardKeyChangeEvent) => this._handleSongKeyChange(index, e.key)}
                @song-card:bpm-change=${(e: SongCardBpmChangeEvent) => this._handleSongBpmChange(index, e.bpm)}
              ></song-card>
            `
          )}

          <button
            class="song-card add-song-button"
            @click=${this._handleAddSong}
          >
            <div class="song-card-info">
              <div class="song-card-title-row">
                <div class="song-card-title">
                  <app-icon name="add" size="20" style="vertical-align: middle; margin-right: 8px;"></app-icon>
                  Add Song
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>
    `
  }

  _handleSongClick(index: number): void {
    this.dispatchEvent(new OverviewSongClickEvent(index))
  }

  _handleSongDelete(index: number): void {
    this.dispatchEvent(new OverviewSongDeleteEvent(index))
  }

  _handleSongKeyChange(index: number, key: string): void {
    this.dispatchEvent(new OverviewSongKeyChangeEvent(index, key))
  }

  _handleSongBpmChange(index: number, bpm: number): void {
    this.dispatchEvent(new OverviewSongBpmChangeEvent(index, bpm))
  }

  _handleAddSong() {
    this.dispatchEvent(new OverviewAddSongEvent())
  }
}

customElements.define('setlist-overview', SetlistOverview)

declare global {
  interface HTMLElementTagNameMap {
    'setlist-overview': SetlistOverview
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [OverviewSongClickEvent.type]: OverviewSongClickEvent
    [OverviewSongDeleteEvent.type]: OverviewSongDeleteEvent
    [OverviewSongKeyChangeEvent.type]: OverviewSongKeyChangeEvent
    [OverviewSongBpmChangeEvent.type]: OverviewSongBpmChangeEvent
    [OverviewAddSongEvent.type]: OverviewAddSongEvent
    [OverviewTuningChangeEvent.type]: OverviewTuningChangeEvent
    [OverviewPitchChangeEvent.type]: OverviewPitchChangeEvent
  }
}
