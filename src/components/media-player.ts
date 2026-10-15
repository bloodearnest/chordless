import type { PropertyValues } from 'lit'
import { html, LitElement } from 'lit'
import './help-tooltip.ts'
import './app-modal.ts'
import './icon.ts'
import { DoubleClickToggleEvent, SongChangeEvent } from '../js/app-events.ts'
import { RouteChangeEvent } from '../js/app-router.ts'
import { loadMediaPlayerState, saveMediaPlayerState } from '../js/media-player-state.ts'
import {
  DEFAULT_DOUBLE_CLICK_BELOW_BPM,
  loadMediaSettings,
  type MediaSettings,
  wantsDoubleClick,
} from '../js/media-settings.ts'
import { MetronomeController, normalizeTempoNote } from '../js/metronome-controller.ts'
import { PadAudioController } from '../js/pad-audio-controller.ts'
import {
  getActivePadSet,
  listPadSets,
  type PadSet,
  PadSetChangedEvent,
} from '../js/pad-set-service.ts'
import { isInModalDialog, isTypingInField } from '../js/utils/keyboard.ts'
import { pointerPosition, trackPointer } from '../js/utils/pointer-drag.ts'
import { MediaSettingsChangeEvent } from './media-player-settings.ts'
import { mediaPlayerStyles } from './media-player-styles.ts'

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext }

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
  _clickMerger?: ChannelMergerNode | null
  _clickSplitter?: ChannelSplitterNode | null
  _boundHandleKeydown?: (event: KeyboardEvent) => void
  _boundHandleRouteChange?: () => void
  _boundHandleSettingsChange?: (event: MediaSettingsChangeEvent) => void
  _boundHandleSongChange?: (event: SongChangeEvent) => void
  _boundHandlePadSetChange?: (event?: PadSetChangedEvent) => void
  _activeVolumeControl: 'pad' | 'click' | null
  _sliderX: number
  _sliderY: number
  _audioContext: AudioContext | null
  _clickGain: GainNode | null
  _metronomeController: MetronomeController | null
  _padController: PadAudioController | null

  static override styles = mediaPlayerStyles

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

    // What the player remembers of itself (independent of which song is active)
    const saved = loadMediaPlayerState()
    this._padsOn = saved.padsOn
    this._clickOn = saved.clickOn

    // Active song state (what's currently loaded in the player)
    this._activeSongId = null
    this._activeSongKey = null
    this._activeSongBpm = null
    this._activeSongTempoNote = null
    this._activeSongTimeSignature = null
    this._activeDoubleClick = false
    this._activeSongTitle = null
    this._activePadSet = getActivePadSet()

    this._collapsed = saved.collapsed
    this._showingSettings = false

    this._dragOffsetX = saved.position.x
    this._dragOffsetY = saved.position.y

    // Volumes, 0 to 1
    this._padVolume = saved.padVolume
    this._clickVolume = saved.clickVolume
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

    // Stop the click if it was just turned off in the settings
    if (!this._metronomeGlobalEnabled && this._metronomeRunning) {
      this._stopMetronome()
    }

    // Update audio routing
    this._updateStereoMode()

    this.requestUpdate()
  }

  async _handleSongChange(event: SongChangeEvent): Promise<void> {
    const song = event.song

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
      this._updateStereoMode()
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
    const tempoNote = normalizeTempoNote(
      this._activeSongTempoNote ?? this._currentTempoNote ?? this.tempoNote
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
      return
    }

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
      this._stopMetronome()
      this._startMetronome()
    } else if (this._clickOn && !wasPlayingClick) {
      this._startMetronome()
    }

    // If we're currently fading out, cancel it and fade back in
    if (this._fadingOut) {
      this._fadingOut = false

      // Restart pads if they're toggled on
      if (this._padsOn) {
        // Fade in (controller will handle playback)
        await this._fadeIn()
      }

      // Click will be started below in the normal flow if needed
    } else if (needsKeyChange && this._padsOn && wasPlayingPads) {
      // Handle pads: crossfade if key changed and pads toggle is on
      await this._crossfadeToNewSong()
    } else if (this._padsOn && !wasPlayingPads) {
      // Pads toggle is on but not playing yet, start them
      const hasSource = await this._updateAudioSource() // Set the audio source before playing
      if (hasSource) {
        await this._fadeIn()
      }
    } else if (this._padsOn && wasPlayingPads && !needsKeyChange) {
      // Pads already playing in the same key - do nothing
    } else if (!this._padsOn) {
      // Pads toggle is off, just update the audio source (preload for later)
      this._updateAudioSource().catch(error => {
        console.error('[MediaPlayer] Failed to preload pad source while pads off:', error)
      })
    }

    // Active song properties already set at the beginning of this method
  }

  _togglePads(): void {
    this._padsOn = !this._padsOn

    saveMediaPlayerState('padsOn', this._padsOn)

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

    saveMediaPlayerState('clickOn', this._clickOn)

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

    saveMediaPlayerState('collapsed', this._collapsed)
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

    const { clientX, clientY } = pointerPosition(e)
    const startX = clientX - this._dragOffsetX
    const startY = clientY - this._dragOffsetY

    // Prevent text selection during drag
    e.preventDefault()

    trackPointer(
      move => {
        const { clientX, clientY } = pointerPosition(move)
        this._dragOffsetX = clientX - startX
        this._dragOffsetY = clientY - startY
      },
      () => saveMediaPlayerState('position', { x: this._dragOffsetX, y: this._dragOffsetY })
    )
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
      const wasFadingIn = this._fadingIn
      const wasFadingOut = this._fadingOut

      // Clear the current fade interval
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

  _startVolumeControl(e: MouseEvent | TouchEvent, type: 'pad' | 'click'): void {
    e.preventDefault()
    e.stopPropagation()

    // Position the slider near the touch point
    const { clientX, clientY } = pointerPosition(e)
    this._sliderX = clientX
    this._sliderY = clientY
    this._activeVolumeControl = type
    this._showingVolumeSlider = true

    trackPointer(
      move => this._handleVolumeMove(move),
      () => {
        this._showingVolumeSlider = false
        this._activeVolumeControl = null
      }
    )
  }

  _handleVolumeMove(e: MouseEvent | TouchEvent): void {
    if (!this._activeVolumeControl) return

    e.preventDefault()

    // Move up from where the touch was last, and the volume follows (200px = full range)
    const { clientY } = pointerPosition(e)
    const change = (this._sliderY - clientY) / 200
    this._sliderY = clientY

    if (this._activeVolumeControl === 'pad') {
      this._padVolume = Math.max(0, Math.min(1, this._padVolume + change))
      this._padController?.setVolume(this._padVolume)
      saveMediaPlayerState('padVolume', this._padVolume)
    } else {
      this._clickVolume = Math.max(0, Math.min(1, this._clickVolume + change))
      this._metronomeController?.setVolume(this._clickVolume)
      saveMediaPlayerState('clickVolume', this._clickVolume)
    }
  }

  /** One of the volume knobs: drag it up and down to turn it */
  _renderKnob(type: 'pad' | 'click', label: string, volume: number) {
    return html`
      <div class="knob-column">
        <div class="knob-label">${label}</div>
        <div
          class="volume-knob ${this._activeVolumeControl === type ? 'dragging' : ''}"
          @mousedown=${(e: MouseEvent) => this._startVolumeControl(e, type)}
          @touchstart=${(e: TouchEvent) => this._startVolumeControl(e, type)}
          title="${type === 'pad' ? 'Pad' : 'Click'} Volume"
        >
          <div class="volume-indicator" style="transform: rotate(${(volume - 0.5) * 270}deg)"></div>
          <div class="volume-value">${Math.round(volume * 11)}</div>
        </div>
      </div>
    `
  }

  /** One of the on/off buttons, with its light */
  _renderToggle(on: boolean, lightClass: string, title: string, toggle: () => void) {
    return html`
      <button
        class="led-button ${on ? 'active' : ''}"
        aria-pressed=${on ? 'true' : 'false'}
        @click=${toggle}
        title=${title}
      >
        <div class="led-light ${on ? lightClass : ''}"></div>
        <span class="led-caption" aria-hidden="true">${on ? 'On' : 'Off'}</span>
      </button>
    `
  }

  /** Collapsed, it is just a pill (always bottom-right): play, stop, expand */
  _renderPill() {
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

  /** The display: what is playing, and what is next (the song being viewed) */
  _renderDisplay() {
    const isDownloading = this._isPadLoading
    const statusText = isDownloading ? 'DOWNLOAD' : this._isPlaying() ? 'PLAYING' : 'STOPPED'
    const statusClass = isDownloading ? 'status-downloading' : ''

    // Next shows the song being viewed, when nothing is active or it isn't the active one
    const viewingDifferentSong =
      this._currentSongId && this._activeSongId && this._currentSongId !== this._activeSongId
    const showNextData = this._currentSongId && (!this._activeSongId || viewingDifferentSong)
    const next = (value: string | number | null | undefined) => (showNextData ? value || '-' : '-')

    const showPadError = this._padLoadFailed && !!this._activeSongKey
    const activeKeyDisplay = showPadError
      ? html`
          <help-tooltip message="Could not load pad sound for this key">
            ${this._activeSongKey}!
          </help-tooltip>
        `
      : this._activeSongKey || '-'

    return html`
      <div class="led-display-section">
        <div class="led-display">
          <!-- Row 1: Headers -->
          <div class="led-label"></div>
          <div class="led-value led-header ${statusClass}">${statusText}</div>
          <div class="led-value led-header">Next</div>

          <!-- Row 2: Key -->
          <div class="led-label">Key</div>
          <div class="led-value ${showPadError ? 'pad-error' : ''}">${activeKeyDisplay}</div>
          <div class="led-value">${next(this.currentKey)}</div>

          <!-- Row 3: BPM -->
          <div class="led-label">BPM</div>
          <div class="led-value">${this._activeSongBpm || '-'}</div>
          <div class="led-value">${next(this._currentBpm)}</div>

          <!-- Row 4: Time -->
          <div class="led-label">Time</div>
          <div class="led-value">${this._activeSongTimeSignature || '-'}</div>
          <div class="led-value">${next(this._currentTimeSignature)}</div>
        </div>
      </div>
    `
  }

  /** Start and stop, and (with the click) the song's double-speed click */
  _renderTransport() {
    const doubleClick = this._doubleClickFor(this._currentBpm, this._currentDoubleClick)
    // The button is always there with the click, so the player keeps its shape; it works on a
    // setlist, where there is a song to be viewed
    const canToggleSpeed = Boolean(this._currentSongId) && !this._isOffSetlist()
    return html`
      <div class="play-stop-section">
        <div class="cassette-buttons">
          <button
            class="play-button ${this._isPlaying() ? 'playing' : ''}"
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
    `
  }

  override render() {
    // If collapsed, show just the pill
    if (this._collapsed) return this._renderPill()

    // With neither the pads nor the click on offer, there is only the title bar and the transport
    const anything = this._padsEnabled || this._metronomeGlobalEnabled
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

        <div class="container" part="container">
          ${anything ? this._renderDisplay() : ''}
          ${this._renderTransport()}
          ${anything ? html`<div class="divider"></div>` : ''}

          <!-- The volume knobs (the click first, over the click's own buttons) -->
          ${
            anything
              ? html`
                <div class="knobs-section">
                  <div class="knobs-row">
                    ${this._metronomeGlobalEnabled ? this._renderKnob('click', 'Click', this._clickVolume) : ''}
                    ${this._padsEnabled ? this._renderKnob('pad', 'Pads', this._padVolume) : ''}
                  </div>
                </div>
              `
              : ''
          }

          <!-- The on/off buttons -->
          ${
            anything
              ? html`
                <div class="toggles-section">
                  <div class="cassette-buttons">
                    ${
                      this._metronomeGlobalEnabled
                        ? this._renderToggle(
                            this._clickOn,
                            'click-on',
                            'Toggle click on/off',
                            this._toggleClick
                          )
                        : ''
                    }
                    ${
                      this._padsEnabled
                        ? this._renderToggle(
                            this._padsOn,
                            'pads-on',
                            'Toggle pads on/off',
                            this._togglePads
                          )
                        : ''
                    }
                  </div>
                </div>
              `
              : ''
          }
        </div>
      </div>
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
