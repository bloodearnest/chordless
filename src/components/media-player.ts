import type { PropertyValues } from 'lit'
import { css, html, LitElement } from 'lit'
import './help-tooltip.ts'
import './app-modal.ts'
import './icon.ts'
import { DoubleClickToggleEvent, SongChangeEvent } from '../js/app-events.ts'
import { RouteChangeEvent } from '../js/app-router.ts'
import {
  DEFAULT_DOUBLE_CLICK_BELOW_BPM,
  loadMediaSettings,
  type MediaSettings,
  wantsDoubleClick,
} from '../js/media-settings.ts'
import { MetronomeController } from '../js/metronome-controller.ts'
import { PadAudioController } from '../js/pad-audio-controller.ts'
import {
  getActivePadSet,
  listPadSets,
  type PadSet,
  PadSetChangedEvent,
} from '../js/pad-set-service.ts'
import { isInModalDialog, isTypingInField } from '../js/utils/keyboard.ts'
import { MediaSettingsChangeEvent } from './media-player-settings.ts'

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext }

/** Where a mouse or touch is, whichever it is */
function pointer(e: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
  return 'touches' in e ? e.touches[0] : e
}

/**
 * MediaPlayer Component
 *
 * A media player for playing pad audio files that fade in/out smoothly.
 *
 * Properties:
 * @property {String} currentKey - The current song key (e.g., "C", "D", "E")
 * @property {Boolean} playing - Whether the player is currently playing
 *
 * Events:
 *
 * CSS Parts:
 * @csspart container - The main container
 * @csspart play-button - The play/pause button
 */
export class MediaPlayer extends LitElement {
  static override properties = {
    currentKey: { type: String, attribute: 'current-key' },
    _stereoSplitEnabled: { state: true },
    _fadingOut: { state: true },
    _fadingIn: { state: true },
    _showingVolumeSlider: { state: true },
    _padVolume: { state: true },
    _clickVolume: { state: true },
    _padsEnabled: { state: true }, // Global setting (from settings page)
    _metronomeGlobalEnabled: { state: true }, // Global setting (from settings page)
    _padsOn: { state: true }, // User toggled pads on/off
    _clickOn: { state: true }, // User toggled click on/off
    _collapsed: { state: true }, // Whether the player is collapsed
    _showingSettings: { state: true }, // Whether settings modal is open
    _dragOffsetX: { state: true }, // Drag position X offset
    _dragOffsetY: { state: true }, // Drag position Y offset
    // Current song metadata (from song-change event, updated on swipe)
    _currentSongId: { state: true },
    _currentSongTitle: { state: true },
    _currentBpm: { state: true },
    _currentTempoNote: { state: true },
    _currentTimeSignature: { state: true },
    _currentDoubleClick: { state: true }, // This user's choice for the song: true, false or undefined (by tempo)
    _currentPadSetId: { state: true }, // This user's pad set for the song, if not the default
    // Active song metadata (loaded in player, only updated when play is pressed)
    _activeSongId: { state: true }, // The song ID currently loaded in media player
    _activeSongKey: { state: true }, // The song key currently loaded in media player
    _activeSongBpm: { state: true },
    _activeSongTempoNote: { state: true },
    _activeSongTimeSignature: { state: true },
    _activeDoubleClick: { state: true }, // Whether the click it was started with is doubled
    _activeSongTitle: { state: true },
    _metronomeRunning: { state: true },
    _padLoadFailed: { state: true },
    _isPadLoading: { state: true },
    _activePadSet: { state: true },
  }

  declare currentKey: string | null
  declare _stereoSplitEnabled: boolean
  declare _fadingOut: boolean
  declare _fadingIn: boolean
  declare _showingVolumeSlider: boolean
  declare _padVolume: number
  declare _clickVolume: number
  declare _padsEnabled: boolean
  declare _metronomeGlobalEnabled: boolean
  declare _padsOn: boolean
  declare _clickOn: boolean
  declare _collapsed: boolean
  declare _showingSettings: boolean
  declare _dragOffsetX: number
  declare _dragOffsetY: number
  declare _currentSongId: string | null | undefined
  declare _currentSongTitle: string | null | undefined
  declare _currentBpm: number | null | undefined
  declare _currentTempoNote: string | null | undefined
  declare _currentTimeSignature: string | null | undefined
  declare _currentDoubleClick: boolean | undefined
  declare _currentPadSetId: string | undefined
  declare _activeSongId: string | null | undefined
  declare _activeSongKey: string | null
  declare _activeSongBpm: number | null | undefined
  declare _activeSongTempoNote: string | null | undefined
  declare _activeSongTimeSignature: string | null | undefined
  declare _activeDoubleClick: boolean
  /** The choice that decided it, to decide again when the settings change */
  _activeDoubleClickChoice?: boolean
  /** The pad set the pads were last started or crossfaded with */
  _loadedPadSetId?: string
  _autoDoubleClick = true
  _doubleClickBelowBpm = DEFAULT_DOUBLE_CLICK_BELOW_BPM
  _emphasiseDownbeat = true
  declare _activeSongTitle: string | null | undefined
  declare _metronomeRunning: boolean
  declare _padLoadFailed: boolean
  declare _isPadLoading: boolean
  declare _activePadSet: PadSet

  bpm: number
  tempoNote: string
  timeSignature: string
  /** Whether the click is on (set by the master toggle; see _toggleMetronome) */
  metronomeEnabled?: boolean
  _fadeInterval?: ReturnType<typeof setInterval> | null
  _clickMerger?: ChannelMergerNode | null
  _clickSplitter?: ChannelSplitterNode | null
  _boundHandleKeydown?: (event: KeyboardEvent) => void
  _boundHandleRouteChange?: () => void
  _boundHandleSettingsChange?: (event: MediaSettingsChangeEvent) => void
  _boundHandleSongChange?: (event: SongChangeEvent) => void
  _boundHandlePadSetChange?: (event?: PadSetChangedEvent) => void
  _isDragging: boolean
  _dragStartX: number
  _dragStartY: number
  _activeVolumeControl: 'pad' | 'click' | null
  _sliderX: number
  _sliderY: number
  _audioContext: AudioContext | null
  _clickGain: GainNode | null
  _metronomeController: MetronomeController | null
  _padController: PadAudioController | null

  static override styles = css`
    :host {
      display: inline-block;
      /*
       * The host keeps its box where the player is by default: dragging moves the player
       * with a transform, which moves nothing of the layout. Left to take pointer events, that
       * empty box would sit over the page. Only the player itself (and the settings modal) do.
       */
      pointer-events: none;
    }

    .player,
    .collapsed-pill,
    app-modal {
      pointer-events: auto;
    }

    .player {
      background: var(--player-bg, #34495e);
      border-radius: 10px;
      color: var(--player-text, white);
      width: fit-content;
      animation: fadeIn 0.2s ease-in-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .title-bar {
      display: flex;
      align-items: stretch;
      justify-content: space-between;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 10px 10px 0 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      cursor: move;
      user-select: none;
    }

    .title-bar-content {
      flex: 1;
      font-size: var(--font-ui);
      font-weight: 500;
      opacity: 0.8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0.25rem 0.5rem;
      display: flex;
      align-items: center;
    }

    .title-bar-buttons {
      display: flex;
      gap: 0;
      flex-shrink: 0;
    }

    .title-bar-button {
      width: 3rem;
      height: auto;
      border-radius: 0;
      border: none;
      border-left: 3px solid rgba(255, 255, 255, 0.1);
      background: transparent;
      color: var(--player-text, white);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-icon);
      opacity: 0.7;
      transition:
        opacity 0.2s,
        background 0.2s;
      padding: 0;
      line-height: 1;
    }

    .title-bar-button:last-child {
      border-radius: 0 10px 0 0;
    }

    .title-bar-button:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.1);
    }

    .title-bar-button:active {
      background: rgba(255, 255, 255, 0.2);
    }

    .container {
      display: grid;
      grid-template-columns: auto 1px auto;
      grid-template-rows: auto auto;
      column-gap: 0.5rem;
      row-gap: 0.8rem;
      padding: 1rem;
    }

    .divider {
      grid-column: 2;
      grid-row: 1 / -1;
      width: 1px;
    }

    .led-display-section {
      grid-column: 1;
      grid-row: 1;
    }

    .play-stop-section {
      grid-column: 1;
      grid-row: 2;
    }

    .knobs-section {
      grid-column: 3;
      grid-row: 1;
      display: flex;
      height: 100%;
    }

    .toggles-section {
      grid-column: 3;
      grid-row: 2;
    }

    .transport-row {
      display: flex;
      align-items: center;
      gap: 0;
    }

    .cassette-buttons {
      display: flex;
      gap: 0;
      width: 100%;
      box-sizing: border-box;
    }

    .cassette-buttons .play-button {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }

    .cassette-buttons .stop-button {
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      margin-left: -2px;
    }

    .cassette-buttons .stop-button:not(:last-child) {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }

    .cassette-buttons .led-button {
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      margin-left: -2px;
    }

    .cassette-buttons .led-button.middle {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }

    .toggles-section .cassette-buttons {
      gap: 1rem;
    }

    .toggles-section .cassette-buttons .led-button {
      border-radius: 4px;
      margin-left: 0;
    }

    .toggles-section .cassette-buttons .led-button.middle {
      border-radius: 4px;
    }

    .knobs-row {
      display: flex;
      align-items: stretch;
      gap: 1rem;
      height: 100%;
    }

    .led-display {
      display: grid;
      grid-template-columns: auto auto auto;
      gap: 0.1rem 0.5rem;
      background: #1a1a1a;
      border: 2px solid var(--player-text, white);
      border-radius: 4px;
      padding: 0.25rem 0.5rem;
      font-family: 'Courier New', monospace;
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
      width: 100%;
      box-sizing: border-box;
      font-size: var(--font-icon);
      color: #00ff00;
      text-shadow:
        0 0 3px #00ff00,
        0 0 6px #00ff00;
    }

    .led-label {
      opacity: 0.5;
      text-align: right;
    }

    .led-value {
      text-align: center;
    }

    .led-value.pad-error {
      color: #ff5c5c;
      text-shadow:
        0 0 3px #ff5c5c,
        0 0 6px #ff5c5c;
      font-weight: 700;
    }

    .led-value.status-downloading {
      color: #ffd479;
      animation: pad-download-blink 1s linear infinite;
      font-weight: 700;
    }

    @keyframes pad-download-blink {
      0% {
        opacity: 1;
      }
      50% {
        opacity: 0.25;
      }
      100% {
        opacity: 1;
      }
    }

    .led-header {
      text-transform: uppercase;
      font-weight: 600;
    }

    .play-button {
      width: 5.4rem;
      height: 3.6rem;
      border-radius: 4px;
      border: 2px solid var(--player-text, white);
      background: transparent;
      color: var(--player-text, white);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-icon);
      line-height: 1;
      box-sizing: border-box;
      transition: all 0.2s;
      outline: none;
    }

    .play-button:active {
      background: rgba(255, 255, 255, 0.2);
    }

    .play-button.playing {
      background: rgba(0, 0, 0, 0.3);
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
    }

    .play-button:disabled {
      cursor: not-allowed;
      background: transparent;
    }

    .play-button:disabled:active {
      background: transparent;
    }

    .play-button.playing:disabled {
      background: rgba(0, 0, 0, 0.3);
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
    }

    .play-button.playing:disabled:active {
      background: rgba(0, 0, 0, 0.3);
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
    }

    .stop-button {
      width: 5.4rem;
      height: 3.6rem;
      border-radius: 4px;
      border: 2px solid var(--player-text, white);
      background: transparent;
      color: var(--player-text, white);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-icon);
      line-height: 1;
      box-sizing: border-box;
      transition: all 0.2s;
      outline: none;
    }

    .stop-button:active {
      background: rgba(255, 255, 255, 0.2);
    }

    .stop-button:disabled {
      cursor: not-allowed;
      background: transparent;
    }

    .stop-button:disabled:active {
      background: transparent;
    }

    .toggle-button {
      width: 3.6rem;
      height: 3.6rem;
      border-radius: 50%;
      border: 2px solid var(--player-text, white);
      background: transparent;
      color: var(--player-text, white);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-icon);
      font-weight: 600;
      line-height: 1;
      box-sizing: border-box;
      transition: all 0.2s;
    }

    .toggle-button:active {
      background: rgba(255, 255, 255, 0.2);
    }

    .toggle-button.active {
      background: rgba(0, 0, 0, 0.3);
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
    }

    .metronome-button {
      width: 3.6rem;
      height: 3.6rem;
      border-radius: 50%;
      border: 2px solid var(--player-text, white);
      background: transparent;
      color: var(--player-text, white);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-ui);
      line-height: 1;
      padding-left: 1.8rem;
      padding-bottom: 0.12rem;
      box-sizing: border-box;
      transition: all 0.2s;
    }

    .metronome-button:active {
      background: rgba(255, 255, 255, 0.2);
    }

    .metronome-button.active {
      background: rgba(0, 0, 0, 0.3);
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
    }

    .split-button {
      width: 3.6rem;
      height: 3.6rem;
      border-radius: 50%;
      border: 2px solid var(--player-text, white);
      background: transparent;
      color: var(--player-text, white);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-icon);
      line-height: 1;
      box-sizing: border-box;
      transition: all 0.2s;
    }

    .split-button:active {
      background: rgba(255, 255, 255, 0.2);
    }

    .split-button.active {
      background: rgba(0, 0, 0, 0.3);
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
    }

    .volume-knob {
      position: relative;
      width: 3.9rem;
      height: 3.9rem;
      border-radius: 50%;
      border: 2px solid var(--player-text, white);
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(0, 0, 0, 0.2) 100%);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      touch-action: none;
      box-sizing: border-box;
      transition: all 0.2s;
      box-shadow:
        inset 0 1px 2px rgba(255, 255, 255, 0.2),
        inset 0 -1px 2px rgba(0, 0, 0, 0.3);
    }

    .volume-knob.dragging {
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.2) 0%, rgba(0, 0, 0, 0.1) 100%);
    }

    .volume-indicator {
      position: absolute;
      top: 0.25rem;
      width: 2px;
      height: 0.5rem;
      background: var(--player-text, white);
      border-radius: 1px;
      transform-origin: center 1.7rem; /* the knob's centre: half its height, less the top */
      transition: transform 0.1s;
    }

    .volume-value {
      font-size: var(--font-icon);
      font-weight: 600;
      color: var(--player-text, white);
      z-index: 1;
    }

    .led-button {
      width: 3.6rem;
      height: 3.6rem;
      border-radius: 4px;
      border: 2px solid var(--player-text, white);
      background: transparent;
      color: var(--player-text, white);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      transition: all 0.2s;
      position: relative;
      outline: none;
    }

    .led-button:active {
      background: rgba(255, 255, 255, 0.2);
    }

    .led-button.active {
      background: rgba(0, 0, 0, 0.3);
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
    }

    /* The transport is as wide as the display above, less the 2× button at its right edge,
       which reaches towards the click's buttons (it is a click setting) and away from Stop */
    .play-stop-section {
      display: flex;
      align-items: stretch;
    }

    .play-stop-section .cassette-buttons {
      flex: 1 1 0;
      min-width: 0;
    }

    .play-stop-section .cassette-buttons .play-button,
    .play-stop-section .cassette-buttons .stop-button {
      flex: 1 1 0;
      min-width: 0;
      width: auto;
    }

    .speed-button {
      flex: 0 0 3.6rem;
      margin-left: 1.1rem;
      margin-right: -0.75rem;
    }

    .speed-button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .led-button {
      flex-direction: column;
      gap: 0.3rem;
    }

    .led-caption {
      font-size: var(--font-ui-small);
      font-weight: 600;
      line-height: 1;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      opacity: 0.8;
    }

    .led-light {
      width: 1.6rem;
      height: 1.6rem;
      border-radius: 50%;
      border: 1px solid var(--player-text, white);
      background: rgba(255, 255, 255, 0.1);
      transition: all 0.2s;
      box-shadow: inset 0 0 3px rgba(0, 0, 0, 0.3);
    }

    .led-light.pads-on {
      background: #27ae60;
      border-color: #27ae60;
      box-shadow:
        0 0 6px rgba(39, 174, 96, 0.8),
        inset 0 0 3px rgba(0, 0, 0, 0.3);
    }

    .led-light.click-on {
      background: #3498db;
      border-color: #3498db;
      box-shadow:
        0 0 6px rgba(52, 152, 219, 0.8),
        inset 0 0 3px rgba(0, 0, 0, 0.3);
    }

    .button-group {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.3rem;
    }

    .button-info {
      font-size: var(--font-icon);
      color: var(--player-text, white);
      opacity: 0.6;
      text-align: center;
    }

    .knob-column {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-evenly;
      width: 3.6rem;
      height: 100%;
    }

    .knob-label {
      font-size: var(--font-icon);
      font-weight: 600;
      color: var(--player-text, white);
      opacity: 0.7;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .collapsed-pill {
      display: flex;
      height: 4rem;
      border-radius: 2rem;
      overflow: hidden;
      background: rgba(52, 73, 94, 0.4);
      -webkit-backdrop-filter: blur(4px);
      backdrop-filter: blur(4px);
      animation: fadeIn 0.2s ease-in-out;
    }

    .pill-button {
      width: 3.5rem;
      border: 0;
      background: transparent;
      color: var(--player-text, white);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      line-height: 1;
      transition: background 0.2s;
    }

    /* The play side is the main target. A triangle's weight is at its base, so it sits right of
       centre to look centred, and the pill's round end takes some of the room on the left */
    .pill-button:first-child {
      width: 4.5rem;
      padding-left: 0.6rem;
    }

    .pill-button + .pill-button {
      border-left: 1px solid rgba(255, 255, 255, 0.25);
    }

    .pill-button:active:not(:disabled) {
      background: rgba(52, 73, 94, 0.8);
    }

    .pill-button:disabled {
      opacity: 0.35;
      cursor: default;
    }
  `

  constructor() {
    super()
    this.currentKey = ''
    this.bpm = 120
    this.tempoNote = '1/4' // Default to quarter notes
    this.timeSignature = '4/4'

    // Global feature toggles (from settings component)
    const globalSettings = loadMediaSettings()
    this._padsEnabled = globalSettings.padsEnabled
    this._metronomeGlobalEnabled = globalSettings.metronomeEnabled
    this._stereoSplitEnabled = globalSettings.stereoSplitEnabled
    this._autoDoubleClick = globalSettings.autoDoubleClick
    this._doubleClickBelowBpm = globalSettings.doubleClickBelowBpm
    this._emphasiseDownbeat = globalSettings.emphasiseDownbeat

    // User toggle states (independent of which song is active)
    // Load saved toggle states from localStorage, default to true (on)
    const savedPadsOn = localStorage.getItem('media-player-pads-on')
    const savedClickOn = localStorage.getItem('media-player-click-on')

    this._padsOn = savedPadsOn !== null ? JSON.parse(savedPadsOn) : true
    this._clickOn = savedClickOn !== null ? JSON.parse(savedClickOn) : true

    // Active song state (what's currently loaded in the player)
    this._activeSongId = null
    this._activeSongKey = null
    this._activeSongBpm = null
    this._activeSongTempoNote = null
    this._activeSongTimeSignature = null
    this._activeDoubleClick = false
    this._activeSongTitle = null
    this._activePadSet = getActivePadSet()

    // UI state - load from localStorage, default to collapsed
    const savedCollapsed = localStorage.getItem('media-player-collapsed')
    this._collapsed = savedCollapsed !== null ? JSON.parse(savedCollapsed) : true
    this._showingSettings = false

    // Drag state
    this._isDragging = false
    this._dragStartX = 0
    this._dragStartY = 0

    // Load saved position from localStorage immediately
    const savedPosition = localStorage.getItem('media-player-position')
    if (savedPosition) {
      const { x, y } = JSON.parse(savedPosition)
      this._dragOffsetX = x
      this._dragOffsetY = y
    } else {
      this._dragOffsetX = 0
      this._dragOffsetY = 0
    }

    // Load persistent volume settings from localStorage
    const savedPadVolume = localStorage.getItem('pad-volume')
    const savedClickVolume = localStorage.getItem('click-volume')

    // Volume properties
    this._padVolume = savedPadVolume !== null ? parseFloat(savedPadVolume) : 0.5 // 0-1 range
    this._clickVolume = savedClickVolume !== null ? parseFloat(savedClickVolume) : 0.8 // 0-1 range
    this._showingVolumeSlider = false
    this._activeVolumeControl = null // 'pad' or 'click'
    this._sliderX = 0
    this._sliderY = 0

    // Controllers (initialized in connectedCallback)
    this._audioContext = null
    this._clickGain = null
    this._metronomeController = null
    this._padController = null

    // State mirrored from controllers
    this._metronomeRunning = false
    this._padLoadFailed = false
    this._isPadLoading = false
    this._fadingIn = false
    this._fadingOut = false
  }

  override connectedCallback() {
    super.connectedCallback()
    this._showIfEnabled(loadMediaSettings())
    this._initAudio()
    const keydown = this._handleKeydown.bind(this)
    const settingsChange = this._handleSettingsChange.bind(this)
    const songChange = this._handleSongChange.bind(this)
    const padSetChange = this._handlePadSetChange.bind(this)
    this._boundHandleKeydown = keydown
    this._boundHandleSettingsChange = settingsChange
    this._boundHandleSongChange = songChange
    this._boundHandlePadSetChange = padSetChange
    // Which page it is on decides whether it offers the song's speed
    this._boundHandleRouteChange = () => this.requestUpdate()
    document.addEventListener(RouteChangeEvent.type, this._boundHandleRouteChange)
    document.addEventListener('keydown', keydown)
    document.addEventListener(MediaSettingsChangeEvent.type, settingsChange)
    document.addEventListener(SongChangeEvent.type, songChange)
    window.addEventListener(PadSetChangedEvent.type, padSetChange)
    // Loaded after the page showed its song (a reload straight onto one): catch up
    if (SongChangeEvent.latest) songChange(SongChangeEvent.latest)
  }

  override disconnectedCallback() {
    super.disconnectedCallback()

    // Cleanup controllers
    if (this._metronomeController) {
      this._metronomeController.cleanup()
    }
    if (this._padController) {
      this._padController.cleanup()
    }

    this._cleanup()
    if (this._boundHandleKeydown) document.removeEventListener('keydown', this._boundHandleKeydown)
    if (this._boundHandleRouteChange) {
      document.removeEventListener(RouteChangeEvent.type, this._boundHandleRouteChange)
    }
    if (this._boundHandleSettingsChange) {
      document.removeEventListener(MediaSettingsChangeEvent.type, this._boundHandleSettingsChange)
    }
    if (this._boundHandleSongChange) {
      document.removeEventListener(SongChangeEvent.type, this._boundHandleSongChange)
    }
    if (this._boundHandlePadSetChange) {
      window.removeEventListener(PadSetChangedEvent.type, this._boundHandlePadSetChange)
    }
  }

  /** The whole player is hidden while it's turned off in the settings */
  _showIfEnabled(settings: Partial<MediaSettings>): void {
    this.style.display = settings.mediaPlayerEnabled === false ? 'none' : ''
  }

  _handleSettingsChange(event: MediaSettingsChangeEvent): void {
    const settings = event.settings
    console.log('[MediaPlayer] Settings changed:', settings)
    this._showIfEnabled(settings)

    this._padsEnabled = settings.padsEnabled !== false
    this._metronomeGlobalEnabled = settings.metronomeEnabled !== false
    this._stereoSplitEnabled = settings.stereoSplitEnabled === true
    this._autoDoubleClick = settings.autoDoubleClick
    this._doubleClickBelowBpm = settings.doubleClickBelowBpm
    this._emphasiseDownbeat = settings.emphasiseDownbeat
    this._metronomeController?.setEmphasiseDownbeat(this._emphasiseDownbeat)
    // A click that is running changes with the tempo threshold, or without the automatic doubling
    if (
      this._metronomeRunning &&
      this._activeDoubleClick !==
        this._doubleClickFor(this._activeSongBpm, this._activeDoubleClickChoice)
    ) {
      this._startSong().catch(error => {
        console.error('[MediaPlayer] Failed to restart the click after a settings change:', error)
      })
    }

    // If only one feature is enabled, ensure it's always "on"
    const bothEnabled = this._padsEnabled && this._metronomeGlobalEnabled
    if (!bothEnabled) {
      if (this._padsEnabled) {
        this._padsOn = true
      }
      if (this._metronomeGlobalEnabled) {
        this._clickOn = true
      }
    }

    // Stop metronome if it was disabled globally
    if (!this._metronomeGlobalEnabled && this.metronomeEnabled) {
      this._stopMetronome()
      this.metronomeEnabled = false
    }

    // Update audio routing
    this._updateAudioRouting()

    this.requestUpdate()
  }

  async _handleSongChange(event: SongChangeEvent): Promise<void> {
    const song = event.song
    console.log('[MediaPlayer] Song changed:', song?.songId, song?.title)

    // Update current song metadata (stored but not activated until play is pressed)
    this._currentSongId = song?.songId || null
    this._currentSongTitle = song?.title || null
    this._currentDoubleClick = event.mediaPrefs.doubleClick
    this._currentPadSetId = event.mediaPrefs.padSetId
    if (song?.metadata?.key) {
      this.currentKey = song.metadata.key
    } else {
      this.currentKey = null
    }
    // Store current song's tempo/time signature metadata
    if (song?.metadata && 'tempo' in song.metadata) {
      this._currentBpm = song.metadata.tempo ? Number(song.metadata.tempo) : null
    }
    if (song?.metadata && 'tempoNote' in song.metadata) {
      this._currentTempoNote = song.metadata.tempoNote || '1/4'
    }
    if (song?.metadata && 'timeSignature' in song.metadata) {
      this._currentTimeSignature = song.metadata.timeSignature || null
    }

    // The pad set is the song's own, if it has one
    await this._updatePadSetForSong()

    // If we're already playing this song and pads/click are active, refresh playback immediately
    const isActiveSong = this._activeSongId && song?.songId && this._activeSongId === song.songId
    const padsPlaying = this._padsOn && this._activeSongKey && this._padController?.isPlaying
    const clickRunning = this._clickOn && this._metronomeRunning

    if (isActiveSong && (padsPlaying || clickRunning)) {
      console.log(
        '[MediaPlayer] Active song metadata changed – restarting playback for crossfade/update'
      )
      this._startSong().catch(error => {
        console.error('[MediaPlayer] Failed to restart song after metadata change:', error)
      })
    }
  }

  /**
   * The pad set for the song being viewed: this user's own choice for it if that is still
   * there (a Drive pad set may not be on this device), else the one chosen for the device
   */
  async _updatePadSetForSong(): Promise<void> {
    let padSet = getActivePadSet()
    const ownId = this._currentPadSetId
    if (ownId && ownId !== padSet.id) {
      const own = (await listPadSets()).find(set => set.id === ownId)
      if (own) padSet = own
    }
    this._activePadSet = padSet
  }

  async _handlePadSetChange(_event?: PadSetChangedEvent): Promise<void> {
    await this._updatePadSetForSong()
    this._padLoadFailed = false

    if (!this._padsOn) {
      this._updateAudioSource().catch(error => {
        console.error('[MediaPlayer] Failed to update pad source after pad-set change:', error)
      })
    }
  }

  /** True from starting a song until it is stopped (shown as the `active` attribute) */
  get isActive(): boolean {
    return Boolean(this._activeSongId || this._metronomeRunning)
  }

  override updated(changedProperties: PropertyValues<this>): void {
    super.updated(changedProperties)
    this.toggleAttribute('active', this.isActive)

    // Handle key changes - just update the source, don't auto-switch
    if (changedProperties.has('currentKey') && this.currentKey && !this._padsOn) {
      // Update the source without playing (pre-load for quick start)
      this._updateAudioSource().catch(error => {
        console.error('[MediaPlayer] Failed to preload pad source:', error)
      })
    }

    // Handle stereo split changes
    if (changedProperties.has('_stereoSplitEnabled')) {
      this._updateAudioRouting()
    }
  }

  _initAudio(): void {
    if (!this._audioContext) {
      // Initialize Web Audio API context
      const AudioContextClass = window.AudioContext || (window as AudioWindow).webkitAudioContext
      if (!AudioContextClass) throw new Error('Web Audio is not available on this device')
      const audioContext = new AudioContextClass()
      this._audioContext = audioContext

      // Create click gain node for metronome
      const clickGain = audioContext.createGain()
      this._clickGain = clickGain
      clickGain.gain.value = this._clickVolume

      // Initialize controllers
      this._metronomeController = new MetronomeController(audioContext, clickGain)
      this._padController = new PadAudioController(audioContext, { fadeDuration: 5000 })

      // Set initial volumes
      this._padController.setVolume(this._padVolume)
      this._metronomeController.setVolume(this._clickVolume)

      // Set stereo mode
      this._updateStereoMode()

      // Load pad if we have a key
      if (this.currentKey) {
        this._padController.loadPad(this.currentKey, this._activePadSet).catch(error => {
          console.error('[MediaPlayer] Failed to load pad during init:', error)
        })
      }
    }
  }

  _normalizeTempoNote(value: string | number | null | undefined): string {
    if (!value) return '1/4'
    if (typeof value === 'number') {
      return `1/${value}`
    }

    let candidate = `${value}`.trim()
    const parenMatch = candidate.match(/\(([^)]+)\)/)
    if (parenMatch) {
      candidate = parenMatch[1].trim()
    }

    const fractionMatch = candidate.match(/(\d+)\s*\/\s*(\d+)/)
    if (fractionMatch) {
      const numerator = Number(fractionMatch[1])
      const denominator = Number(fractionMatch[2])
      if (numerator > 0 && denominator > 0) {
        return `${numerator}/${denominator}`
      }
    }

    const denomOnlyMatch = candidate.match(/^(\d+)$/)
    if (denomOnlyMatch) {
      const denom = Number(denomOnlyMatch[1])
      if (denom > 0) {
        return `1/${denom}`
      }
    }

    return '1/4'
  }

  async _updateAudioSource(): Promise<boolean> {
    if (!this.currentKey) return false

    // Ensure audio is initialized
    this._initAudio()

    if (!this._padController) {
      console.warn('[MediaPlayer] Cannot load pad: controller not initialized')
      return false
    }

    // Load pad using controller
    const loaded = await this._padController.loadPad(this.currentKey, this._activePadSet)
    this._padLoadFailed = !loaded
    this._isPadLoading = this._padController.isLoading
    return loaded
  }

  _cleanup(): void {
    // Cleanup is now handled by controllers in disconnectedCallback
    // This method kept for compatibility
  }

  _handleKeydown(event: KeyboardEvent): void {
    // Hidden (off a setlist with nothing playing, or turned off), the player has no
    // claim on the keys: Space belongs to the button or switch that has focus
    if (this.getClientRects().length === 0) return
    // A modal handles its own keys: Esc closes it, Space presses its buttons
    if (isInModalDialog(event)) return
    // Space toggles: it starts the song being viewed, and stops it while it plays.
    // Off a setlist there is no song being viewed, so it only stops
    if (event.code === 'Space' && !isTypingInField(event)) {
      event.preventDefault()
      if (this._isOffSetlist()) {
        if (this._isPlaying()) this._stop()
      } else if (this._isCurrentSongActive() && this._isPlaying()) {
        this._stop()
      } else {
        this._startSong()
      }
    }
    // Stop button on Escape - fade out and stop
    if (event.code === 'Escape') {
      event.preventDefault()
      this._stop()
    }
  }

  /** Whether the page is something other than a setlist (the app says which in body[data-view]) */
  _isOffSetlist(): boolean {
    const view = document.body.dataset.view
    return view !== undefined && view !== 'setlist'
  }

  /** Whether anything is sounding: the pads, or the click */
  _isPlaying(): boolean {
    return Boolean(this._padController?.isPlaying || this._metronomeRunning)
  }

  async _stop(): Promise<void> {
    console.log('[MediaPlayer] Stop - stopping click and fading out pads')

    // Check what's actually playing (panic button semantics: treat existing audio as playing)
    const padsAvailable = !!this._padController
    const clickPlaying = this._metronomeRunning

    // Stop click immediately if playing (but don't change toggle state)
    // This also resets the beat counter so it starts fresh next time
    if (clickPlaying) {
      this._stopMetronome()
    }

    // Fade out pads if we currently have audio wired up
    if (padsAvailable) {
      await this._fadeOut()
    }

    // Clear active song properties so play button is no longer disabled
    this._activeSongId = null
    this._activeSongKey = null
    this._activeSongBpm = null
    this._activeSongTempoNote = null
    this._activeSongTimeSignature = null
    this._activeSongTitle = null
    this._padLoadFailed = false

    // Force UI update
    this.requestUpdate()
  }

  _toggleMetronome(): void {
    this.metronomeEnabled = !this.metronomeEnabled

    if (this.metronomeEnabled) {
      this._startMetronome()
    } else {
      this._stopMetronome()
    }
  }

  _updateStereoMode(): void {
    if (!this._padController) return

    if (this._stereoSplitEnabled) {
      this._padController.setStereoMode('left')
    } else {
      this._padController.setStereoMode('both')
    }

    // Click routing - handled manually since it's simpler
    this._updateClickRouting()
  }

  _updateClickRouting(): void {
    if (!this._audioContext || !this._clickGain) return

    this._clickGain.disconnect()

    if (this._stereoSplitEnabled) {
      // Route click to right channel only
      const splitter = this._audioContext.createChannelSplitter(2)
      const merger = this._audioContext.createChannelMerger(2)

      this._clickGain.connect(splitter)
      splitter.connect(merger, 0, 1) // Left input to right output
      merger.connect(this._audioContext.destination)

      // Store for cleanup
      this._clickMerger = merger
      this._clickSplitter = splitter
    } else {
      // Normal stereo routing
      this._clickGain.connect(this._audioContext.destination)
      this._clickMerger = null
      this._clickSplitter = null
    }
  }

  _updateAudioRouting(): void {
    // Legacy method - redirect to new method
    this._updateStereoMode()
  }

  /** Whether the click is doubled for a song with this tempo and this user's choice */
  _doubleClickFor(bpm: number | null | undefined, choice: boolean | undefined): boolean {
    return wantsDoubleClick(
      { autoDoubleClick: this._autoDoubleClick, doubleClickBelowBpm: this._doubleClickBelowBpm },
      bpm,
      choice
    )
  }

  /** Double or normal speed for the song being viewed: remembered for this user, by the page */
  _toggleDoubleClick(): void {
    const doubled = this._doubleClickFor(this._currentBpm, this._currentDoubleClick)
    const byTempo = this._doubleClickFor(this._currentBpm, undefined)
    // The song only keeps a choice that differs from what its tempo gives
    document.dispatchEvent(new DoubleClickToggleEvent(!doubled === byTempo ? undefined : !doubled))
  }

  _startMetronome(): void {
    // A song with no tempo has no click: there is no beat to keep
    const bpmValue = this._activeSongBpm ?? this._currentBpm
    if (!bpmValue) {
      this._stopMetronome()
      return
    }
    const timeSignature =
      this._activeSongTimeSignature ?? this._currentTimeSignature ?? this.timeSignature
    const tempoNote = this._normalizeTempoNote(
      this._activeSongTempoNote ?? this._currentTempoNote ?? this.tempoNote ?? '1/4'
    )

    // Ensure audio is initialized
    this._initAudio()

    if (!this._metronomeController) {
      console.warn('[MediaPlayer] Cannot start metronome: controller not initialized')
      return
    }

    // Start the metronome using controller
    const started = this._metronomeController.start(bpmValue, timeSignature, tempoNote, {
      doubleClick: this._activeDoubleClick,
      emphasiseDownbeat: this._emphasiseDownbeat,
    })
    this._metronomeRunning = started
    this.requestUpdate()
  }

  _stopMetronome(): void {
    if (!this._metronomeController) {
      return
    }

    this._metronomeController.stop()
    this._metronomeRunning = false
    this.requestUpdate()
  }

  async _startSong(): Promise<void> {
    if (!this.currentKey) {
      console.warn('[MediaPlayer] No key set, cannot start song')
      return
    }

    // Check if this song is already the active one
    if (this._isCurrentSongActive()) {
      console.log('[MediaPlayer] Current song is already active, ignoring')
      return
    }

    console.log(
      '[MediaPlayer] Starting song:',
      this.currentKey,
      this._currentBpm,
      this._currentTimeSignature
    )

    // Store old active song values to check if we need to change
    const oldActiveKey = this._activeSongKey
    const oldActiveBpm = this._activeSongBpm
    const oldPadSetId = this._loadedPadSetId
    const doubleClick = this._doubleClickFor(this._currentBpm, this._currentDoubleClick)

    // A different key, or this song's own pad set, is a different pad to play
    const needsKeyChange =
      oldActiveKey &&
      (oldActiveKey !== this.currentKey || (oldPadSetId && oldPadSetId !== this._activePadSet.id))
    const needsTempoChange =
      oldActiveBpm &&
      (this._activeSongBpm !== this._currentBpm ||
        this._activeDoubleClick !== doubleClick ||
        this._activeSongTempoNote !== this._currentTempoNote ||
        this._activeSongTimeSignature !== this._currentTimeSignature)

    const wasPlayingPads = this._padsOn && oldActiveKey && this._padController?.isPlaying
    const wasPlayingClick = this._clickOn && oldActiveBpm && this._metronomeRunning

    console.log('[MediaPlayer] _startSong state check:', {
      _padsOn: this._padsOn,
      _padsEnabled: this._padsEnabled,
      _clickOn: this._clickOn,
      _metronomeGlobalEnabled: this._metronomeGlobalEnabled,
      wasPlayingPads,
      wasPlayingClick,
      oldActiveKey,
      needsKeyChange,
    })

    // Reset pad failure state for the new active selection
    this._padLoadFailed = false

    // Set this as the active song BEFORE starting pads/click
    // This ensures the metronome has access to the tempo/time signature
    this._activeSongId = this._currentSongId
    this._activeSongKey = this.currentKey
    this._activeSongBpm = this._currentBpm
    this._activeSongTempoNote = this._currentTempoNote
    this._activeSongTimeSignature = this._currentTimeSignature
    this._activeDoubleClick = doubleClick
    this._activeDoubleClickChoice = this._currentDoubleClick
    this._loadedPadSetId = this._activePadSet.id
    this._activeSongTitle = this._currentSongTitle

    // Handle click immediately so metronome isn't blocked by pad loading
    if (needsTempoChange && this._clickOn && wasPlayingClick) {
      console.log('[MediaPlayer] Restarting click with new tempo:', this._currentBpm)
      this._stopMetronome()
      this._startMetronome()
    } else if (this._clickOn && !wasPlayingClick) {
      console.log('[MediaPlayer] Starting click for first time')
      this._startMetronome()
    }

    // If we're currently fading out, cancel it and fade back in
    if (this._fadingOut) {
      console.log('[MediaPlayer] Canceling fade-out and reversing to fade-in')
      if (this._fadeInterval) {
        clearInterval(this._fadeInterval)
        this._fadeInterval = null
      }
      this._fadingOut = false

      // Restart pads if they're toggled on
      if (this._padsOn) {
        // Fade in (controller will handle playback)
        await this._fadeIn()
      }

      // Click will be started below in the normal flow if needed
    } else if (needsKeyChange && this._padsOn && wasPlayingPads) {
      // Handle pads: crossfade if key changed and pads toggle is on
      console.log('[MediaPlayer] Crossfading pads from', oldActiveKey, 'to', this.currentKey)
      await this._crossfadeToNewSong()
    } else if (this._padsOn && !wasPlayingPads) {
      // Pads toggle is on but not playing yet, start them
      console.log('[MediaPlayer] Starting pads for first time, _padsOn =', this._padsOn)
      const hasSource = await this._updateAudioSource() // Set the audio source before playing
      if (hasSource) {
        await this._fadeIn()
      }
    } else if (this._padsOn && wasPlayingPads && !needsKeyChange) {
      // Pads already playing in the same key - do nothing
      console.log('[MediaPlayer] Pads already playing in same key, no action needed')
    } else if (!this._padsOn) {
      // Pads toggle is off, just update the audio source (preload for later)
      console.log('[MediaPlayer] Pads off, preloading audio source')
      this._updateAudioSource().catch(error => {
        console.error('[MediaPlayer] Failed to preload pad source while pads off:', error)
      })
    }

    // Active song properties already set at the beginning of this method
  }

  _togglePads(): void {
    this._padsOn = !this._padsOn
    console.log('[MediaPlayer] Pads toggle:', this._padsOn)

    // Save to localStorage
    localStorage.setItem('media-player-pads-on', JSON.stringify(this._padsOn))

    // If a song is active, immediately start/stop pads
    if (this._activeSongKey) {
      if (this._padsOn) {
        // Turn pads on - fade in
        this._fadeIn()
      } else {
        // Turn pads off - fade out
        this._fadeOut()
      }
    }
    // Song is still "playing" - toggles just control outputs
  }

  _toggleClick(): void {
    this._clickOn = !this._clickOn
    console.log('[MediaPlayer] Click toggle:', this._clickOn)

    // Save to localStorage
    localStorage.setItem('media-player-click-on', JSON.stringify(this._clickOn))

    // If a song is active, immediately start/stop click
    if (this._activeSongBpm) {
      if (this._clickOn) {
        // Turn click on - start metronome
        this._startMetronome()
      } else {
        // Turn click off - stop metronome
        this._stopMetronome()
      }
    }
  }

  _toggleCollapse(): void {
    this._collapsed = !this._collapsed
    console.log('[MediaPlayer] Collapsed:', this._collapsed)

    // Save to localStorage
    localStorage.setItem('media-player-collapsed', JSON.stringify(this._collapsed))
  }

  _toggleSettings(): void {
    this._showingSettings = !this._showingSettings
  }

  _closeSettings(event: Event): void {
    // Only our own modal's close, not one bubbling from inside it
    if (event.target === event.currentTarget) this._showingSettings = false
  }

  _startDrag(e: MouseEvent | TouchEvent): void {
    // Don't start drag if clicking on a button
    if ((e.target as Element).closest('.title-bar-button')) {
      return
    }

    this._isDragging = true
    const { clientX, clientY } = pointer(e)

    this._dragStartX = clientX - this._dragOffsetX
    this._dragStartY = clientY - this._dragOffsetY

    // Prevent text selection during drag
    e.preventDefault()

    // Add global event listeners
    const handleMove = (moveEvent: MouseEvent | TouchEvent) => this._handleDrag(moveEvent)
    const handleEnd = () => this._endDrag(handleMove, handleEnd)

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleEnd)
    document.addEventListener('touchmove', handleMove)
    document.addEventListener('touchend', handleEnd)
  }

  _handleDrag(e: MouseEvent | TouchEvent): void {
    if (!this._isDragging) return

    const { clientX, clientY } = pointer(e)

    this._dragOffsetX = clientX - this._dragStartX
    this._dragOffsetY = clientY - this._dragStartY

    this._applyPosition()
  }

  _endDrag(handleMove: (e: MouseEvent | TouchEvent) => void, handleEnd: () => void): void {
    this._isDragging = false

    // Remove global event listeners
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleEnd)
    document.removeEventListener('touchmove', handleMove)
    document.removeEventListener('touchend', handleEnd)

    // Save position to localStorage
    localStorage.setItem(
      'media-player-position',
      JSON.stringify({
        x: this._dragOffsetX,
        y: this._dragOffsetY,
      })
    )
  }

  _applyPosition(): void {
    // Position is now applied directly in the template via style binding
    // Just trigger a re-render
    this.requestUpdate()
  }

  _isCurrentSongActive(): boolean {
    return (
      this._activeSongKey === this.currentKey &&
      this._activeSongBpm === this._currentBpm &&
      this._activeSongTempoNote === this._currentTempoNote &&
      this._activeSongTimeSignature === this._currentTimeSignature &&
      this._activeDoubleClick ===
        this._doubleClickFor(this._currentBpm, this._currentDoubleClick) &&
      // A song with a pad set of its own is not the one playing, even in the same key
      (this._loadedPadSetId === undefined || this._loadedPadSetId === this._activePadSet.id)
    )
  }

  async _crossfadeToNewSong(): Promise<void> {
    if (!this._padController || !this.currentKey) {
      console.warn('[MediaPlayer] Cannot crossfade: controller not initialized')
      return
    }

    console.log('[MediaPlayer] Crossfading to new song')

    await this._padController.crossfadeTo(this.currentKey, this._activePadSet)
    this._padLoadFailed = this._padController.loadFailed
    this._padsOn = !this._padLoadFailed
  }

  async _togglePlay(): Promise<void> {
    if (!this.currentKey) {
      console.warn('[MediaPlayer] No key set, cannot play')
      return
    }

    // If currently fading, interrupt and switch direction
    if (this._fadingIn || this._fadingOut) {
      console.log('[MediaPlayer] Interrupting current fade to switch direction')
      const wasFadingIn = this._fadingIn
      const wasFadingOut = this._fadingOut

      // Clear the current fade interval
      if (this._fadeInterval) {
        clearInterval(this._fadeInterval)
        this._fadeInterval = null
      }
      // Reset fading states
      this._fadingIn = false
      this._fadingOut = false

      // Do the opposite of what we were doing
      if (wasFadingOut) {
        await this._fadeIn()
      } else if (wasFadingIn) {
        await this._fadeOut()
      }
      return
    }

    if (this._padsOn) {
      await this._fadeOut()
    } else {
      await this._fadeIn()
    }
  }

  async _fadeIn(): Promise<void> {
    if (!this._padController) {
      console.error('[MediaPlayer] Cannot fade in: controller not initialized')
      return
    }

    this._fadingIn = true
    this._padsOn = true
    await this._padController.play()
    this._fadingIn = false
  }

  async _fadeOut(): Promise<void> {
    if (!this._padController) return

    this._fadingOut = true
    await this._padController.stop()
    this._fadingOut = false
  }

  async _crossfadeToNewKey(): Promise<void> {
    if (!this._padController || !this.currentKey) {
      console.warn('[MediaPlayer] Cannot crossfade: controller not initialized')
      return
    }

    this._fadingOut = true
    this._fadingIn = true

    await this._padController.crossfadeTo(this.currentKey, this._activePadSet)
    this._padLoadFailed = this._padController.loadFailed

    this._fadingOut = false
    this._fadingIn = false
  }

  _getStatusText(): string {
    if (this._fadingIn) return 'Fading in...'
    if (this._fadingOut) return 'Fading out...'
    if (this._padsOn) return 'Playing'
    return 'Stopped'
  }

  _startVolumeControl(e: MouseEvent | TouchEvent, type: 'pad' | 'click'): void {
    e.preventDefault()
    e.stopPropagation()

    // Get initial touch/click position
    const { clientX, clientY } = pointer(e)

    // Position slider near the touch point
    this._sliderX = clientX
    this._sliderY = clientY
    this._activeVolumeControl = type
    this._showingVolumeSlider = true

    // Add move/end listeners
    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      this._handleVolumeMove(moveEvent)
    }

    const handleEnd = () => {
      this._showingVolumeSlider = false
      this._activeVolumeControl = null
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('touchmove', handleMove)
      document.removeEventListener('touchend', handleEnd)
      this.requestUpdate()
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleEnd)
    document.addEventListener('touchmove', handleMove)
    document.addEventListener('touchend', handleEnd)
  }

  _handleVolumeMove(e: MouseEvent | TouchEvent): void {
    if (!this._activeVolumeControl) return

    e.preventDefault()

    // Get vertical position relative to initial touch
    const { clientY } = pointer(e)

    // Calculate delta from start (negative = up, positive = down)
    const delta = this._sliderY - clientY

    // Convert to percentage change (200px = full range)
    const change = delta / 200

    // Get current volume
    const currentVolume = this._activeVolumeControl === 'pad' ? this._padVolume : this._clickVolume

    // Calculate new volume
    const newVolume = Math.max(0, Math.min(1, currentVolume + change))

    // Update volume
    if (this._activeVolumeControl === 'pad') {
      this._padVolume = newVolume
      // Update pad controller volume
      if (this._padController) {
        this._padController.setVolume(this._padVolume)
      }
      // Save to localStorage
      localStorage.setItem('pad-volume', this._padVolume.toString())
    } else if (this._activeVolumeControl === 'click') {
      this._clickVolume = newVolume
      // Update metronome controller volume
      if (this._metronomeController) {
        this._metronomeController.setVolume(this._clickVolume)
      }
      // Save to localStorage
      localStorage.setItem('click-volume', this._clickVolume.toString())
    }

    // Update slider Y position for next calculation
    this._sliderY = clientY

    this.requestUpdate()
  }

  override render() {
    const isPlaying = this._isPlaying()
    const isDownloading = this._isPadLoading
    const statusText = isDownloading ? 'DOWNLOAD' : isPlaying ? 'PLAYING' : 'STOPPED'
    const statusClass = isDownloading ? 'status-downloading' : ''

    // Check if we're viewing a different song than what's playing
    // Compare song IDs instead of individual properties
    const viewingDifferentSong =
      this._currentSongId && this._activeSongId && this._currentSongId !== this._activeSongId

    // Show Next column data if: we have a current song ID AND (nothing is active OR viewing different song)
    const showNextData = this._currentSongId && (!this._activeSongId || viewingDifferentSong)

    const doubleClick = this._doubleClickFor(this._currentBpm, this._currentDoubleClick)
    // The button is always there with the click, so the player keeps its shape; it works on a
    // setlist, where there is a song to be viewed
    const canToggleSpeed = Boolean(this._currentSongId) && !this._isOffSetlist()
    const showPadError = this._padLoadFailed && !!this._activeSongKey
    const activeKeyDisplay = showPadError
      ? html`
          <help-tooltip message="Could not load pad sound for this key">
            ${this._activeSongKey}!
          </help-tooltip>
        `
      : this._activeSongKey || '-'

    // If collapsed, show just the pill (always bottom-right): play, stop, expand
    if (this._collapsed) {
      return html`
        <div class="collapsed-pill">
          <button
            class="pill-button"
            @click=${this._startSong}
            aria-label="Start song"
            title="Start song"
            ?disabled=${!this.currentKey || this._isCurrentSongActive()}
          >
            <app-icon name="play" size="30"></app-icon>
          </button>
          <button
            class="pill-button"
            @click=${this._stop}
            aria-label="Stop"
            title="Stop"
            ?disabled=${!this._isPlaying()}
          >
            <app-icon name="stop" size="24" style="--icon-stroke: 2.5"></app-icon>
          </button>
          <button
            class="pill-button"
            @click=${this._toggleCollapse}
            aria-label="Expand player"
            title="Expand player"
          >
            <app-icon name="chevron-up" size="28"></app-icon>
          </button>
        </div>
      `
    }

    return html`
      <app-modal
        heading="Media Player Settings"
        .open=${this._showingSettings}
        @app-modal:close=${this._closeSettings}
      >
        ${
          // Rendered while open, so it shows the settings as they are now
          this._showingSettings
            ? html`
              <media-player-settings
                .mediaPlayerEnabled=${true}
                .padsEnabled=${this._padsEnabled}
                .metronomeEnabled=${this._metronomeGlobalEnabled}
                .stereoSplitEnabled=${this._stereoSplitEnabled}
              ></media-player-settings>
            `
            : ''
        }
      </app-modal>

      <div
        class="player"
        part="player"
        style="transform: translate(${this._dragOffsetX}px, ${this._dragOffsetY}px);"
      >
        <!-- Title bar -->
        <div class="title-bar" @mousedown=${this._startDrag} @touchstart=${this._startDrag}>
          <div class="title-bar-content">${this._activeSongTitle || 'Media Player'}</div>
          <div class="title-bar-buttons">
            <button class="title-bar-button" @click=${this._toggleSettings} title="Settings">
              <app-icon name="settings"></app-icon>
            </button>
            <button class="title-bar-button" @click=${this._toggleCollapse} title="Minimize">
              <app-icon name="chevron-down"></app-icon>
            </button>
          </div>
        </div>

        <!-- Container with grid layout -->
        <div class="container" part="container">
          <!-- Row 1, Column 1: LED display -->
          ${
            this._padsEnabled || this._metronomeGlobalEnabled
              ? html`
                <div class="led-display-section">
                  <div class="led-display">
                    <!-- Row 1: Headers -->
                    <div class="led-label"></div>
                    <div class="led-value led-header ${statusClass}">${statusText}</div>
                    <div class="led-value led-header">Next</div>

                    <!-- Row 2: Key -->
                    <div class="led-label">Key</div>
                    <div class="led-value ${showPadError ? 'pad-error' : ''}">
                      ${activeKeyDisplay}
                    </div>
                    <div class="led-value">${showNextData ? this.currentKey || '-' : '-'}</div>

                    <!-- Row 3: BPM -->
                    <div class="led-label">BPM</div>
                    <div class="led-value">${this._activeSongBpm || '-'}</div>
                    <div class="led-value">${showNextData ? this._currentBpm || '-' : '-'}</div>

                    <!-- Row 4: Time -->
                    <div class="led-label">Time</div>
                    <div class="led-value">${this._activeSongTimeSignature || '-'}</div>
                    <div class="led-value">
                      ${showNextData ? this._currentTimeSignature || '-' : '-'}
                    </div>
                  </div>
                </div>
              `
              : ''
          }

          <!-- Row 2, Column 1: Play/Stop buttons -->
          <div class="play-stop-section">
            <div class="cassette-buttons">
              <button
                class="play-button ${isPlaying ? 'playing' : ''}"
                part="start-song-button"
                @click=${this._startSong}
                aria-label="Start song"
                title="Start song (Space)"
                ?disabled=${!this.currentKey || this._isCurrentSongActive()}
              >
                <app-icon name="play" size="32"></app-icon>
              </button>
              <button
                class="stop-button"
                part="stop-button"
                @click=${this._stop}
                aria-label="Stop (Escape)"
                title="Stop - Press Escape"
              >
                <app-icon name="stop" size="32"></app-icon>
              </button>
            </div>
            ${
              this._metronomeGlobalEnabled
                ? html`
                    <!-- At the end of the transport, by the click's buttons: the song's double-speed click -->
                    <button
                      class="led-button speed-button ${doubleClick ? 'active' : ''}"
                      @click=${this._toggleDoubleClick}
                      aria-pressed=${doubleClick ? 'true' : 'false'}
                      aria-label="Double-speed click for this song"
                      title="Double-speed click for this song"
                      ?disabled=${!canToggleSpeed}
                    >
                      <div class="led-light ${doubleClick ? 'click-on' : ''}"></div>
                      <span class="led-caption" aria-hidden="true">2×</span>
                    </button>
                  `
                : ''
            }
          </div>

          <!-- Divider spanning both rows -->
          ${
            this._padsEnabled || this._metronomeGlobalEnabled
              ? html` <div class="divider"></div> `
              : ''
          }

          <!-- Row 1, Column 3: Volume knobs (the click first, over the click's own buttons) -->
          ${
            this._padsEnabled || this._metronomeGlobalEnabled
              ? html`
                <div class="knobs-section">
                  <div class="knobs-row">
                    ${
                      this._metronomeGlobalEnabled
                        ? html`
                          <div class="knob-column">
                            <div class="knob-label">Click</div>
                            <div
                              class="volume-knob ${
                                this._activeVolumeControl === 'click' ? 'dragging' : ''
                              }"
                              @mousedown=${(e: MouseEvent) => this._startVolumeControl(e, 'click')}
                              @touchstart=${(e: TouchEvent) => this._startVolumeControl(e, 'click')}
                              title="Click Volume"
                            >
                              <div
                                class="volume-indicator"
                                style="transform: rotate(${(this._clickVolume - 0.5) * 270}deg)"
                              ></div>
                              <div class="volume-value">${Math.round(this._clickVolume * 11)}</div>
                            </div>
                          </div>
                        `
                        : ''
                    }
                    ${
                      this._padsEnabled
                        ? html`
                          <div class="knob-column">
                            <div class="knob-label">Pads</div>
                            <div
                              class="volume-knob ${
                                this._activeVolumeControl === 'pad' ? 'dragging' : ''
                              }"
                              @mousedown=${(e: MouseEvent) => this._startVolumeControl(e, 'pad')}
                              @touchstart=${(e: TouchEvent) => this._startVolumeControl(e, 'pad')}
                              title="Pad Volume"
                            >
                              <div
                                class="volume-indicator"
                                style="transform: rotate(${(this._padVolume - 0.5) * 270}deg)"
                              ></div>
                              <div class="volume-value">${Math.round(this._padVolume * 11)}</div>
                            </div>
                          </div>
                        `
                        : ''
                    }
                  </div>
                </div>
              `
              : ''
          }

          <!-- Row 2, Column 3: LED toggle buttons -->
          ${
            this._padsEnabled || this._metronomeGlobalEnabled
              ? html`
                <div class="toggles-section">
                  <div class="cassette-buttons">
                    ${
                      this._metronomeGlobalEnabled
                        ? html`
                          <button
                            class="led-button ${this._clickOn ? 'active' : ''}"
                            aria-pressed=${this._clickOn ? 'true' : 'false'}
                            @click=${this._toggleClick}
                            title="Toggle click on/off"
                          >
                            <div class="led-light ${this._clickOn ? 'click-on' : ''}"></div>
                            <span class="led-caption" aria-hidden="true">${this._clickOn ? 'On' : 'Off'}</span>
                          </button>
                        `
                        : ''
                    }
                    ${
                      this._padsEnabled
                        ? html`
                          <button
                            class="led-button ${this._padsOn ? 'active' : ''}"
                            aria-pressed=${this._padsOn ? 'true' : 'false'}
                            @click=${this._togglePads}
                            title="Toggle pads on/off"
                          >
                            <div class="led-light ${this._padsOn ? 'pads-on' : ''}"></div>
                            <span class="led-caption" aria-hidden="true">${this._padsOn ? 'On' : 'Off'}</span>
                          </button>
                        `
                        : ''
                    }
                  </div>
                </div>
              `
              : ''
          }
        </div>
        <!-- End container -->
      </div>
      <!-- End player -->
    `
  }
}

// Define the custom element
customElements.define('media-player', MediaPlayer)

declare global {
  interface HTMLElementTagNameMap {
    'media-player': MediaPlayer
  }
}
