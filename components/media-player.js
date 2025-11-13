import { LitElement, html, css } from 'lit';
import './help-tooltip.js';
import { normalizePadKey } from '../js/pad-keys.js';
import { getActivePadSet, getPadCacheUrl, ensurePadKeyCached, isPadKeyCached } from '../js/pad-set-service.js';

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
 * @fires play-state-change - When play/pause state changes
 *
 * CSS Parts:
 * @csspart container - The main container
 * @csspart play-button - The play/pause button
 */
export class MediaPlayer extends LitElement {
    static properties = {
        currentKey: { type: String, attribute: 'current-key' },
        stereoSplitEnabled: { type: Boolean, state: true },
        _fadingOut: { type: Boolean, state: true },
        _fadingIn: { type: Boolean, state: true },
        _showingVolumeSlider: { type: Boolean, state: true },
        _padVolume: { type: Number, state: true },
        _clickVolume: { type: Number, state: true },
        _padsEnabled: { type: Boolean, state: true }, // Global setting (from settings page)
        _metronomeGlobalEnabled: { type: Boolean, state: true }, // Global setting (from settings page)
        _padsOn: { type: Boolean, state: true }, // User toggled pads on/off
        _clickOn: { type: Boolean, state: true }, // User toggled click on/off
        _collapsed: { type: Boolean, state: true }, // Whether the player is collapsed
        _showingSettings: { type: Boolean, state: true }, // Whether settings modal is open
        _dragOffsetX: { type: Number, state: true }, // Drag position X offset
        _dragOffsetY: { type: Number, state: true }, // Drag position Y offset
        // Current song metadata (from song-change event, updated on swipe)
        _currentSongId: { type: String, state: true },
        _currentSongTitle: { type: String, state: true },
        _currentBpm: { type: Number, state: true },
        _currentTempoNote: { type: String, state: true },
        _currentTimeSignature: { type: String, state: true },
        // Active song metadata (loaded in player, only updated when play is pressed)
        _activeSongId: { type: String, state: true }, // The song ID currently loaded in media player
        _activeSongKey: { type: String, state: true }, // The song key currently loaded in media player
        _activeSongBpm: { type: Number, state: true },
        _activeSongTempoNote: { type: String, state: true },
        _activeSongTimeSignature: { type: String, state: true },
        _activeSongTitle: { type: String, state: true },
        _metronomeRunning: { type: Boolean, state: true },
        _padLoadFailed: { type: Boolean, state: true },
        _isPadLoading: { type: Boolean, state: true },
        _activePadSet: { type: Object, state: true }
    };

    static styles = css`
        :host {
            display: inline-block;
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
            font-size: 0.9rem;
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
            font-size: 1.2rem;
            opacity: 0.7;
            transition: opacity 0.2s, background 0.2s;
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
            gap: 0.5rem 1rem;
            background: #1a1a1a;
            border: 2px solid var(--player-text, white);
            border-radius: 4px;
            padding: 0.25rem 0.5rem;
            font-family: 'Courier New', monospace;
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
            width: 100%;
            box-sizing: border-box;
            font-size: 0.75rem;
            color: #00ff00;
            text-shadow: 0 0 3px #00ff00, 0 0 6px #00ff00;
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
            text-shadow: 0 0 3px #ff5c5c, 0 0 6px #ff5c5c;
            font-weight: 700;
        }

        .led-value.status-downloading {
            color: #ffd479;
            animation: pad-download-blink 1s linear infinite;
            font-weight: 700;
        }

        @keyframes pad-download-blink {
            0% { opacity: 1; }
            50% { opacity: 0.25; }
            100% { opacity: 1; }
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
            font-size: 1.44rem;
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
            font-size: 1.44rem;
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
            font-size: 0.84rem;
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
            font-size: 2.4rem;
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
            font-size: 1.44rem;
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
            width: 3.4rem;
            height: 3.4rem;
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
            box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.2), inset 0 -1px 2px rgba(0, 0, 0, 0.3);
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
            transform-origin: center 1.45rem;
            transition: transform 0.1s;
        }

        .volume-value {
            font-size: 0.7rem;
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

        .led-light {
            width: 1.2rem;
            height: 1.2rem;
            border-radius: 50%;
            border: 1px solid var(--player-text, white);
            background: rgba(255, 255, 255, 0.1);
            transition: all 0.2s;
            box-shadow: inset 0 0 3px rgba(0, 0, 0, 0.3);
        }

        .led-light.pads-on {
            background: #27ae60;
            border-color: #27ae60;
            box-shadow: 0 0 6px rgba(39, 174, 96, 0.8), inset 0 0 3px rgba(0, 0, 0, 0.3);
        }

        .led-light.click-on {
            background: #3498db;
            border-color: #3498db;
            box-shadow: 0 0 6px rgba(52, 152, 219, 0.8), inset 0 0 3px rgba(0, 0, 0, 0.3);
        }

        .button-group {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.3rem;
        }

        .button-info {
            font-size: 0.7rem;
            color: var(--player-text, white);
            opacity: 0.6;
            text-align: center;
        }

        .knob-column {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: space-between;
            width: 3.6rem;
            height: 100%;
        }

        .knob-label {
            font-size: 0.95rem;
            font-weight: 600;
            color: var(--player-text, white);
            opacity: 0.7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .toggle-label {
            font-size: 0.95rem;
            font-weight: 600;
            color: var(--player-text, white);
            opacity: 0.7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-top: 0.3rem;
            line-height: 1;
        }

        .collapsed-button {
            width: 4rem;
            height: 4rem;
            border-radius: 50%;
            border: 2px solid var(--player-text, white);
            background: rgba(52, 73, 94, 0.6);
            color: var(--player-text, white);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2rem;
            backdrop-filter: blur(4px);
            transition: background 0.2s;
            padding: 0;
            padding-left: 0.2rem;
            line-height: 1;
            animation: fadeIn 0.2s ease-in-out;
        }

        .collapsed-button:active {
            background: rgba(52, 73, 94, 0.8);
        }


        .settings-modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2000;
        }

        .settings-content {
            background: var(--player-bg, #34495e);
            border-radius: 10px;
            padding: 2rem;
            max-width: 500px;
            width: 90%;
            position: relative;
        }

        .settings-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
        }

        .settings-title {
            font-size: 1.5rem;
            font-weight: 600;
            color: var(--player-text, white);
        }

        .close-button {
            width: 2rem;
            height: 2rem;
            border-radius: 50%;
            border: 1px solid var(--player-text, white);
            background: transparent;
            color: var(--player-text, white);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.2rem;
            line-height: 1;
        }

        .close-button:active {
            background: rgba(255, 255, 255, 0.2);
        }
    `;

    constructor() {
        super();
        this.currentKey = '';
        this.bpm = 120;
        this.tempoNote = '1/4'; // Default to quarter notes
        this.timeSignature = '4/4';
        this._fadingOut = false;
        this._fadingIn = false;
        this._audio = null;
        this._fadeInterval = null;
        this._fadeDuration = 5000; // 5 seconds

        // Load global settings from localStorage
        const savedSettings = localStorage.getItem('setalight-media-settings');
        let globalSettings = {};
        if (savedSettings) {
            globalSettings = JSON.parse(savedSettings);
        }

        // Global feature toggles (from settings component)
        this._padsEnabled = globalSettings.padsEnabled !== false; // Default true
        this._metronomeGlobalEnabled = globalSettings.metronomeEnabled !== false; // Default true
        this.stereoSplitEnabled = globalSettings.stereoSplitEnabled === true; // Default false

        // User toggle states (independent of which song is active)
        // Load saved toggle states from localStorage, default to true (on)
        const savedPadsOn = localStorage.getItem('media-player-pads-on');
        const savedClickOn = localStorage.getItem('media-player-click-on');

        this._padsOn = savedPadsOn !== null ? JSON.parse(savedPadsOn) : true;
        this._clickOn = savedClickOn !== null ? JSON.parse(savedClickOn) : true;

        // Active song state (what's currently loaded in the player)
        this._activeSongId = null;
        this._activeSongKey = null;
        this._activeSongBpm = null;
        this._activeSongTempoNote = null;
        this._activeSongTimeSignature = null;
        this._activeSongTitle = null;
        this._activePadSet = getActivePadSet();

        // UI state - load from localStorage, default to collapsed
        const savedCollapsed = localStorage.getItem('media-player-collapsed');
        this._collapsed = savedCollapsed !== null ? JSON.parse(savedCollapsed) : true;
        this._showingSettings = false;

        // Drag state
        this._isDragging = false;
        this._dragStartX = 0;
        this._dragStartY = 0;

        // Load saved position from localStorage immediately
        const savedPosition = localStorage.getItem('media-player-position');
        if (savedPosition) {
            const { x, y } = JSON.parse(savedPosition);
            this._dragOffsetX = x;
            this._dragOffsetY = y;
        } else {
            this._dragOffsetX = 0;
            this._dragOffsetY = 0;
        }

        // Load persistent volume settings from localStorage
        const savedPadVolume = localStorage.getItem('setalight-pad-volume');
        const savedClickVolume = localStorage.getItem('setalight-click-volume');

        // Volume properties
        this._padVolume = savedPadVolume !== null ? parseFloat(savedPadVolume) : 0.5; // 0-1 range
        this._clickVolume = savedClickVolume !== null ? parseFloat(savedClickVolume) : 0.8; // 0-1 range
        this._showingVolumeSlider = false;
        this._activeVolumeControl = null; // 'pad' or 'click'
        this._sliderX = 0;
        this._sliderY = 0;

        // Metronome properties
        this._metronomeInterval = null;
        this._beatInterval = null; // Stores the calculated beat interval in ms
        this._metronomeBeat = 0;
        this._audioContext = null;
        this._clickGain = null;
        this._activeOscillators = []; // Track active oscillators for cleanup
        this._metronomeRunning = false;
        this._padLoadFailed = false;
        this._isPadLoading = false;
        this._padLoadingCount = 0;
        this._boundPadAudioErrorHandler = (event) => this._handlePadAudioError(event);
    }

    connectedCallback() {
        super.connectedCallback();
        this._initAudio();
        this._boundHandleKeydown = this._handleKeydown.bind(this);
        this._boundHandleSettingsChange = this._handleSettingsChange.bind(this);
        this._boundHandleSongChange = this._handleSongChange.bind(this);
        this._boundHandlePadSetChange = this._handlePadSetChange.bind(this);
        document.addEventListener('keydown', this._boundHandleKeydown);
        document.addEventListener('settings-change', this._boundHandleSettingsChange);
        document.addEventListener('song-change', this._boundHandleSongChange);
        window.addEventListener('pad-set-changed', this._boundHandlePadSetChange);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._cleanup();
        document.removeEventListener('keydown', this._boundHandleKeydown);
        document.removeEventListener('settings-change', this._boundHandleSettingsChange);
        document.removeEventListener('song-change', this._boundHandleSongChange);
        window.removeEventListener('pad-set-changed', this._boundHandlePadSetChange);
    }

    _handleSettingsChange(event) {
        const settings = event.detail;
        console.log('[MediaPlayer] Settings changed:', settings);

        this._padsEnabled = settings.padsEnabled !== false;
        this._metronomeGlobalEnabled = settings.metronomeEnabled !== false;
        this.stereoSplitEnabled = settings.stereoSplitEnabled === true;

        // If only one feature is enabled, ensure it's always "on"
        const bothEnabled = this._padsEnabled && this._metronomeGlobalEnabled;
        if (!bothEnabled) {
            if (this._padsEnabled) {
                this._padsOn = true;
            }
            if (this._metronomeGlobalEnabled) {
                this._clickOn = true;
            }
        }

        // Stop metronome if it was disabled globally
        if (!this._metronomeGlobalEnabled && this.metronomeEnabled) {
            this._stopMetronome();
            this.metronomeEnabled = false;
        }

        // Update audio routing
        this._updateAudioRouting();

        this.requestUpdate();
    }

    _handleSongChange(event) {
        const song = event.detail.song;
        console.log('[MediaPlayer] Song changed:', song?.songId, song?.title);

        // Update current song metadata (stored but not activated until play is pressed)
        this._currentSongId = song?.songId || null;
        this._currentSongTitle = song?.title || null;
        if (song?.metadata?.key) {
            this.currentKey = song.metadata.key;
        } else {
            this.currentKey = null;
        }
        // Store current song's tempo/time signature metadata
        if (song?.metadata && 'tempo' in song.metadata) {
            this._currentBpm = song.metadata.tempo ? Number(song.metadata.tempo) : null;
        }
        if (song?.metadata && 'tempoNote' in song.metadata) {
            this._currentTempoNote = song.metadata.tempoNote || '1/4';
        }
        if (song?.metadata && 'timeSignature' in song.metadata) {
            this._currentTimeSignature = song.metadata.timeSignature || null;
        }

        // If we're already playing this song and pads/click are active, refresh playback immediately
        const isActiveSong = this._activeSongId && song?.songId && this._activeSongId === song.songId;
        const padsPlaying = this._padsOn && this._activeSongKey && this._audio && !this._audio.paused;
        const clickRunning = this._clickOn && this._metronomeRunning;

        if (isActiveSong && (padsPlaying || clickRunning)) {
            console.log('[MediaPlayer] Active song metadata changed – restarting playback for crossfade/update');
            this._startSong().catch((error) => {
                console.error('[MediaPlayer] Failed to restart song after metadata change:', error);
            });
        }
    }

    _handlePadSetChange(event) {
        const padSet = event?.detail?.padSet || getActivePadSet();
        this._activePadSet = padSet;
        this._padLoadFailed = false;

        if (!this._padsOn) {
            this._updateAudioSource().catch((error) => {
                console.error('[MediaPlayer] Failed to update pad source after pad-set change:', error);
            });
        }
    }

    updated(changedProperties) {
        super.updated(changedProperties);

        // Handle key changes - just update the source, don't auto-switch
        if (changedProperties.has('currentKey') && this.currentKey && !this._padsOn) {
            // Update the source without playing (pre-load for quick start)
            this._updateAudioSource().catch((error) => {
                console.error('[MediaPlayer] Failed to preload pad source:', error);
            });
        }

        // Handle stereo split changes
        if (changedProperties.has('stereoSplitEnabled')) {
            this._updateAudioRouting();
        }
    }

    _initAudio() {
        if (!this._audio) {
            // Initialize Web Audio API context for pads routing
            if (!this._audioContext) {
                this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            this._audio = this._createPadAudioElement();

            // Create Web Audio nodes for pad audio
            this._padSource = this._audioContext.createMediaElementSource(this._audio);
            this._padGain = this._audioContext.createGain();
            this._padGain.gain.value = 0; // Start silent

            // Create Web Audio gain node for metronome clicks
            this._clickGain = this._audioContext.createGain();
            this._clickGain.gain.value = this._clickVolume;
            this._clickGain.connect(this._audioContext.destination);

            // Initial routing (will be updated by _updateAudioRouting)
            this._padSource.connect(this._padGain);
            this._padGain.connect(this._audioContext.destination);

            // Update source if we have a key
            if (this.currentKey) {
                this._updateAudioSource().catch((error) => {
                    console.error('[MediaPlayer] Failed to prepare pad source during init:', error);
                });
            }
        }
    }

    _createPadAudioElement() {
        const audio = new Audio();
        audio.loop = true;
        audio.crossOrigin = 'anonymous';
        audio.addEventListener('error', this._boundPadAudioErrorHandler);
        return audio;
    }

    _handlePadAudioError(event) {
        const source = event?.target?.currentSrc || event?.target?.src || this._audio?.currentSrc || this._audio?.src;
        console.warn('[MediaPlayer] Pad audio error:', source || this.currentKey || 'unknown source', event?.error || event);
        this._padLoadFailed = true;
        this._fadingIn = false;
        this._fadingOut = false;

        if (this._padGain) {
            this._padGain.gain.value = 0;
        }

        if (event?.target && !event.target.paused) {
            try {
                event.target.pause();
            } catch (err) {
                console.debug('[MediaPlayer] Unable to pause errored pad audio source:', err);
            }
        }
    }

    _getPadFilenameKey(key) {
        if (!key) return null;
        return normalizePadKey(key);
    }

    _normalizeTempoNote(value) {
        if (!value) return '1/4';
        if (typeof value === 'number') {
            return `1/${value}`;
        }

        let candidate = `${value}`.trim();
        const parenMatch = candidate.match(/\(([^)]+)\)/);
        if (parenMatch) {
            candidate = parenMatch[1].trim();
        }

        const fractionMatch = candidate.match(/(\d+)\s*\/\s*(\d+)/);
        if (fractionMatch) {
            const numerator = Number(fractionMatch[1]);
            const denominator = Number(fractionMatch[2]);
            if (numerator > 0 && denominator > 0) {
                return `${numerator}/${denominator}`;
            }
        }

        const denomOnlyMatch = candidate.match(/^(\d+)$/);
        if (denomOnlyMatch) {
            const denom = Number(denomOnlyMatch[1]);
            if (denom > 0) {
                return `1/${denom}`;
            }
        }

        return '1/4';
    }

    async _resolvePadUrlForKey(key) {
        if (!key) return null;
        const padKey = this._getPadFilenameKey(key);
        if (!padKey) {
            return null;
        }

        if (this._activePadSet && this._activePadSet.type === 'drive') {
            const alreadyCached = await isPadKeyCached(this._activePadSet, padKey);
            if (!alreadyCached) {
                this._padLoadingCount++;
                this._isPadLoading = true;
                try {
                    await ensurePadKeyCached(this._activePadSet, padKey);
                } catch (error) {
                    console.error('[MediaPlayer] Failed to cache pad audio from Drive:', error);
                    return null;
                } finally {
                    this._padLoadingCount = Math.max(0, this._padLoadingCount - 1);
                    if (this._padLoadingCount === 0) {
                        this._isPadLoading = false;
                    }
                }
            }
            return getPadCacheUrl(this._activePadSet.id, padKey);
        }

        return `/pads/${encodeURIComponent(padKey)} - WARM - CHURCHFRONT PADS.mp3`;
    }

    async _updateAudioSource() {
        if (!this._audio || !this.currentKey) return false;

        const isActiveKey = this._activeSongKey && this.currentKey === this._activeSongKey;
        const url = await this._resolvePadUrlForKey(this.currentKey);
        if (!url) {
            console.warn(`[MediaPlayer] No pad audio available for key "${this.currentKey}"`);
            this._audio.removeAttribute('src');
            if (isActiveKey) {
                this._padLoadFailed = true;
            }
            return false;
        }

        console.log('[MediaPlayer] Setting audio source:', url);
        this._audio.src = url;
        if (isActiveKey) {
            this._padLoadFailed = false;
        }
        return true;
    }

    _cleanup() {
        if (this._fadeInterval) {
            clearInterval(this._fadeInterval);
            this._fadeInterval = null;
        }
        if (this._audio) {
            this._audio.pause();
            this._audio.removeEventListener('error', this._boundPadAudioErrorHandler);
            this._audio.src = '';
            this._audio = null;
        }
    }

    _handleKeydown(event) {
        // Start song on spacebar
        if (event.code === 'Space' && !event.target.matches('input, textarea')) {
            event.preventDefault();
            this._startSong();
        }
        // Stop button on Escape - fade out and stop
        if (event.code === 'Escape') {
            event.preventDefault();
            this._stop();
        }
    }

    async _stop() {
        console.log('[MediaPlayer] Stop - stopping click and fading out pads');

        // Check what's actually playing (panic button semantics: treat existing audio as playing)
        const padsAvailable = !!this._audio;
        const padsPlaying = padsAvailable && !this._audio.paused;
        const clickPlaying = this._metronomeRunning;

        // Stop click immediately if playing (but don't change toggle state)
        // This also resets the beat counter so it starts fresh next time
        if (clickPlaying) {
            this._stopMetronome();
        }

        // Fade out pads if we currently have audio wired up
        if (padsAvailable) {
            await this._fadeOut();
        }

        // Clear active song properties so play button is no longer disabled
        this._activeSongId = null;
        this._activeSongKey = null;
        this._activeSongBpm = null;
        this._activeSongTempoNote = null;
        this._activeSongTimeSignature = null;
        this._activeSongTitle = null;
        this._padLoadFailed = false;

        // Force UI update
        this.requestUpdate();
    }

    _toggleMetronome() {
        this.metronomeEnabled = !this.metronomeEnabled;

        if (this.metronomeEnabled) {
            this._startMetronome();
        } else {
            this._stopMetronome();
        }
    }


    _updateAudioRouting() {
        if (!this._audioContext) return;

        // Update pad audio routing
        if (this._padGain) {
            this._padGain.disconnect();

            if (this.stereoSplitEnabled) {
                // Route pads to left channel only
                const splitter = this._audioContext.createChannelSplitter(2);
                const merger = this._audioContext.createChannelMerger(2);

                this._padGain.connect(splitter);
                splitter.connect(merger, 0, 0); // Left input to left output
                merger.connect(this._audioContext.destination);

                // Store for cleanup
                this._padMerger = merger;
                this._padSplitter = splitter;
            } else {
                // Normal stereo routing
                this._padGain.connect(this._audioContext.destination);
                this._padMerger = null;
                this._padSplitter = null;
            }
        }

        // Update click routing
        if (this._clickGain) {
            this._clickGain.disconnect();

            if (this.stereoSplitEnabled) {
                // Route click to right channel only
                const splitter = this._audioContext.createChannelSplitter(2);
                const merger = this._audioContext.createChannelMerger(2);

                this._clickGain.connect(splitter);
                splitter.connect(merger, 0, 1); // Left input to right output
                merger.connect(this._audioContext.destination);

                // Store for cleanup
                this._clickMerger = merger;
                this._clickSplitter = splitter;
            } else {
                // Normal stereo routing
                this._clickGain.connect(this._audioContext.destination);
                this._clickMerger = null;
                this._clickSplitter = null;
            }
        }
    }

    _startMetronome() {
        const bpmValue = this._activeSongBpm ?? this._currentBpm ?? this.bpm;
        const timeSignature = this._activeSongTimeSignature ?? this._currentTimeSignature ?? this.timeSignature;
        const tempoNote = this._normalizeTempoNote(this._activeSongTempoNote ?? this._currentTempoNote ?? this.tempoNote ?? '1/4');

        if (!bpmValue || !timeSignature) {
            console.warn('[MediaPlayer] Cannot start metronome: missing BPM or time signature');
            if (this._metronomeRunning) {
                this._metronomeRunning = false;
                this.requestUpdate();
            }
            return;
        }

        // Ensure audio is initialized (this will create _audioContext and _clickGain)
        this._initAudio();

        if (!this._audioContext || !this._clickGain) {
            console.warn('[MediaPlayer] Cannot start metronome: audio context not ready');
            if (this._metronomeRunning) {
                this._metronomeRunning = false;
                this.requestUpdate();
            }
            return;
        }

        // Resume AudioContext if suspended
        if (this._audioContext.state === 'suspended') {
            this._audioContext.resume();
        }

        // Update gain to current volume setting
        this._clickGain.gain.value = this._clickVolume;

        const bpm = Number(bpmValue);

        console.log(`[MediaPlayer] Starting metronome at ${bpm} BPM, ${tempoNote} notes, ${timeSignature}`);

        // Parse and log time signature
        const [beatsPerBar] = timeSignature.split('/').map(Number);
        console.log(`[MediaPlayer] Time signature parsed: ${timeSignature} -> beatsPerBar: ${beatsPerBar}`);

        // Reset beat counter
        this._metronomeBeat = 0;

        // Calculate interval based on BPM and note subdivision
        // First, convert BPM to quarter note tempo based on tempoNote and time signature
        // The stored BPM represents beats per minute for whatever note value is in tempoNote
        let quarterNoteBpm = bpm; // Default assumes quarter notes

        // Special case: compound time signatures (6/8, 9/8, 12/8) with default tempo note
        // In compound time, "plain BPM" (quarter note default) means the dotted quarter note (compound beat)
        const [beatsPerMeasure, noteValue] = timeSignature.split('/').map(Number);
        const isCompoundTime = noteValue === 8 && beatsPerMeasure % 3 === 0;
        console.log(`[MediaPlayer] Compound time check: beatsPerMeasure=${beatsPerMeasure}, noteValue=${noteValue}, isCompoundTime=${isCompoundTime}, tempoNote=${tempoNote}`);

        if (tempoNote === '1/4' && isCompoundTime) {
            // BPM refers to dotted quarter notes (3 eighths)
            // Convert to eighth note tempo: bpm × 3
            // Then convert to quarter note tempo: (bpm × 3) / 2 = bpm × 1.5
            quarterNoteBpm = bpm * 1.5;
            console.log(`[MediaPlayer] Applied compound time conversion: ${bpm} -> ${quarterNoteBpm}`);
        } else if (tempoNote && tempoNote !== '1/4') {
            const [numerator, denominator] = tempoNote.split('/').map(Number);
            if (numerator && denominator) {
                // Convert to quarter note tempo
                // 1/8 note tempo: multiply by 0.5 (eighth notes are twice as fast as quarters)
                // 1/16 note tempo: multiply by 0.25
                // 1/2 note tempo: multiply by 2
                // Formula: quarterNoteBpm = bpm * (tempoNote / quarterNote)
                //        = bpm * (numerator/denominator) / (1/4)
                //        = bpm * (numerator * 4 / denominator)
                quarterNoteBpm = bpm * (numerator * 4 / denominator);
            }
        }

        // Now calculate quarter note interval using the converted BPM
        const quarterNoteInterval = 60000 / quarterNoteBpm; // milliseconds per quarter note

        // Calculate multiplier based on note subdivision for the actual clicks
        // We click on the note value from the time signature (e.g., 8th notes in 6/8)
        // 1/4 = 1.0 (quarter notes)
        // 1/8 = 0.5 (eighth notes, twice as fast)
        // 1/16 = 0.25 (sixteenth notes, four times as fast)
        // 1/2 = 2.0 (half notes, half as fast)

        // For compound time, we click on eighth notes regardless of tempo note
        let clickNoteValue;
        if (isCompoundTime) {
            clickNoteValue = 8; // Always click on eighth notes in compound time
        } else {
            // Use the note value from time signature, or tempo note if specified differently
            clickNoteValue = noteValue;
        }

        // Convert click note value to multiplier relative to quarter notes
        const multiplier = (1 / clickNoteValue) * 4; // e.g., 1/8 * 4 = 0.5

        const beatInterval = quarterNoteInterval * multiplier;
        console.log(`[MediaPlayer] BPM: ${bpm} (${tempoNote}) -> Quarter note BPM: ${quarterNoteBpm.toFixed(1)} -> Clicking on 1/${clickNoteValue} notes -> Click interval: ${beatInterval.toFixed(1)}ms (multiplier: ${multiplier})`);

        // Store the beat interval for the scheduling loop
        this._beatInterval = beatInterval;
        this._metronomeRunning = true;
        this.requestUpdate();

        // Start the metronome scheduling loop
        // Play first click immediately, then schedule subsequent clicks
        this._playClick();
        this._scheduleNextClick();
    }

    _scheduleNextClick() {
        if (!this._beatInterval || !this._metronomeRunning) return;

        // Use setTimeout for the next click
        // This ensures consistent timing even if _playClick() takes some time to execute
        this._metronomeInterval = setTimeout(() => {
            if (!this._metronomeRunning) {
                return;
            }
            this._playClick();
            this._scheduleNextClick(); // Schedule the next one
        }, this._beatInterval);
    }

    _stopMetronome() {
        if (!this._metronomeRunning && !this._metronomeInterval) {
            return;
        }

        console.log('[MediaPlayer] Stopping metronome, active oscillators:', this._activeOscillators?.length || 0);

        // Clear timeout and beat interval
        if (this._metronomeInterval) {
            clearTimeout(this._metronomeInterval);
            this._metronomeInterval = null;
        }
        this._beatInterval = null;

        // Reset beat counter
        this._metronomeBeat = 0;

        // Stop all active oscillators immediately
        if (this._activeOscillators && this._activeOscillators.length > 0) {
            this._activeOscillators.forEach(oscillator => {
                try {
                    oscillator.stop();
                    oscillator.disconnect();
                } catch (e) {
                    // Oscillator may have already stopped
                    console.log('[MediaPlayer] Error stopping oscillator (may be already stopped):', e.message);
                }
            });
            this._activeOscillators = [];
        }

        this._metronomeRunning = false;
        this.requestUpdate();

        console.log('[MediaPlayer] Metronome stopped');
    }

    _playClick() {
        if (!this._audioContext) return;
        if (!this._activeSongTimeSignature) return; // No active song

        // Parse time signature to get beats per bar and note value
        const timeSignature = this._activeSongTimeSignature;
        const [beatsPerBar, noteValue] = timeSignature.split('/').map(Number);

        // Determine accent level based on beat position and time signature
        let clickType = 'light'; // Default: light

        if (this._metronomeBeat === 0) {
            // First beat is always heavy (downbeat)
            clickType = 'heavy';
        } else if (beatsPerBar === 6 && noteValue === 8 && this._metronomeBeat === 3) {
            // Special case: 6/8 gets medium accent on beat 4 (index 3)
            // This represents two groups of three eighth notes
            clickType = 'medium';
        } else if (beatsPerBar === 12 && noteValue === 8) {
            // Special case: 12/8 - treat like 4/4 with medium accents every 3 beats
            // Pattern: Heavy - light - light - Medium - light - light - Medium - light - light - Medium - light - light
            if (this._metronomeBeat === 3 || this._metronomeBeat === 6 || this._metronomeBeat === 9) {
                clickType = 'medium';
            }
        }
        // General pattern for everything else:
        // First beat: heavy
        // All other beats: light
        // Works for: 4/4, 3/4, 5/8, 7/8, etc.

        // Create oscillator for click sound
        const oscillator = this._audioContext.createOscillator();
        const envelope = this._audioContext.createGain();

        oscillator.connect(envelope);
        envelope.connect(this._clickGain);

        // Set frequency and gain based on accent type
        if (clickType === 'heavy') {
            oscillator.frequency.value = 1000;
            envelope.gain.value = 2.0;
        } else if (clickType === 'medium') {
            oscillator.frequency.value = 900;
            envelope.gain.value = 1.5;
        } else { // light
            oscillator.frequency.value = 800;
            envelope.gain.value = 1.0;
        }

        const now = this._audioContext.currentTime;
        oscillator.start(now);

        // Quick decay envelope for sharp click
        envelope.gain.setValueAtTime(envelope.gain.value, now);
        envelope.gain.exponentialRampToValueAtTime(0.01, now + 0.03);

        oscillator.stop(now + 0.03);

        // Track this oscillator for cleanup
        this._activeOscillators.push(oscillator);

        // Remove from tracking after it stops
        setTimeout(() => {
            const index = this._activeOscillators.indexOf(oscillator);
            if (index > -1) {
                this._activeOscillators.splice(index, 1);
            }
        }, 50);

        // Increment beat counter
        this._metronomeBeat = (this._metronomeBeat + 1) % beatsPerBar;
    }

    async _startSong() {
        if (!this.currentKey) {
            console.warn('[MediaPlayer] No key set, cannot start song');
            return;
        }

        // Check if this song is already the active one
        if (this._isCurrentSongActive()) {
            console.log('[MediaPlayer] Current song is already active, ignoring');
            return;
        }

        console.log('[MediaPlayer] Starting song:', this.currentKey, this._currentBpm, this._currentTimeSignature);

        // Store old active song values to check if we need to change
        const oldActiveKey = this._activeSongKey;
        const oldActiveBpm = this._activeSongBpm;

        const needsKeyChange = oldActiveKey && oldActiveKey !== this.currentKey;
        const needsTempoChange = oldActiveBpm && (
            this._activeSongBpm !== this._currentBpm ||
            this._activeSongTempoNote !== this._currentTempoNote ||
            this._activeSongTimeSignature !== this._currentTimeSignature
        );

        const wasPlayingPads = this._padsOn && oldActiveKey && !this._audio?.paused;
        const wasPlayingClick = this._clickOn && oldActiveBpm && this._metronomeRunning;

        console.log('[MediaPlayer] _startSong state check:', {
            _padsOn: this._padsOn,
            _padsEnabled: this._padsEnabled,
            _clickOn: this._clickOn,
            _metronomeGlobalEnabled: this._metronomeGlobalEnabled,
            wasPlayingPads,
            wasPlayingClick,
            oldActiveKey,
            needsKeyChange
        });

        // Reset pad failure state for the new active selection
        this._padLoadFailed = false;

        // Set this as the active song BEFORE starting pads/click
        // This ensures the metronome has access to the tempo/time signature
        this._activeSongId = this._currentSongId;
        this._activeSongKey = this.currentKey;
        this._activeSongBpm = this._currentBpm;
        this._activeSongTempoNote = this._currentTempoNote;
        this._activeSongTimeSignature = this._currentTimeSignature;
        this._activeSongTitle = this._currentSongTitle;

        // Handle click immediately so metronome isn't blocked by pad loading
        if (needsTempoChange && this._clickOn && wasPlayingClick) {
            console.log('[MediaPlayer] Restarting click with new tempo:', this._currentBpm);
            this._stopMetronome();
            this._startMetronome();
        } else if (this._clickOn && !wasPlayingClick) {
            console.log('[MediaPlayer] Starting click for first time');
            this._startMetronome();
        } else if (!this._clickOn && wasPlayingClick) {
            console.log('[MediaPlayer] Click toggle off, stopping');
            this._stopMetronome();
        }

        // If we're currently fading out, cancel it and fade back in
        if (this._fadingOut) {
            console.log('[MediaPlayer] Canceling fade-out and reversing to fade-in');
            if (this._fadeInterval) {
                clearInterval(this._fadeInterval);
                this._fadeInterval = null;
            }
            this._fadingOut = false;

            // Restart pads if they're toggled on
            if (this._padsOn) {
                // Resume playback if paused
                if (this._audio?.paused) {
                    await this._audio.play();
                }
                // Fade in from current volume
                await this._fadeIn();
            }

            // Click will be started below in the normal flow if needed
        } else if (needsKeyChange && this._padsOn && wasPlayingPads) {
            // Handle pads: crossfade if key changed and pads toggle is on
            console.log('[MediaPlayer] Crossfading pads from', oldActiveKey, 'to', this.currentKey);
            await this._crossfadeToNewSong();
        } else if (this._padsOn && !wasPlayingPads) {
            // Pads toggle is on but not playing yet, start them
            console.log('[MediaPlayer] Starting pads for first time, _padsOn =', this._padsOn);
            const hasSource = await this._updateAudioSource(); // Set the audio source before playing
            if (hasSource) {
                await this._fadeIn();
            }
        } else if (!this._padsOn && wasPlayingPads) {
            // Pads toggle was turned off while playing, fade out
            console.log('[MediaPlayer] Pads toggle off, fading out');
            await this._fadeOut();
        } else if (this._padsOn && wasPlayingPads && !needsKeyChange) {
            // Pads already playing in the same key - do nothing
            console.log('[MediaPlayer] Pads already playing in same key, no action needed');
        } else if (!this._padsOn) {
            // Pads toggle is off, just update the audio source (preload for later)
            console.log('[MediaPlayer] Pads off, preloading audio source');
            this._updateAudioSource().catch((error) => {
                console.error('[MediaPlayer] Failed to preload pad source while pads off:', error);
            });
        }

        // Active song properties already set at the beginning of this method
    }

    _togglePads() {
        this._padsOn = !this._padsOn;
        console.log('[MediaPlayer] Pads toggle:', this._padsOn);

        // Save to localStorage
        localStorage.setItem('media-player-pads-on', JSON.stringify(this._padsOn));

        // If a song is active, immediately start/stop pads
        if (this._activeSongKey) {
            if (this._padsOn) {
                // Turn pads on - fade in
                this._fadeIn();
            } else {
                // Turn pads off - fade out
                this._fadeOut();
            }
        }
        // Song is still "playing" - toggles just control outputs
    }

    _toggleClick() {
        this._clickOn = !this._clickOn;
        console.log('[MediaPlayer] Click toggle:', this._clickOn);

        // Save to localStorage
        localStorage.setItem('media-player-click-on', JSON.stringify(this._clickOn));

        // If a song is active, immediately start/stop click
        if (this._activeSongBpm) {
            if (this._clickOn) {
                // Turn click on - start metronome
                this._startMetronome();
            } else {
                // Turn click off - stop metronome
                this._stopMetronome();
            }
        }
    }

    _toggleCollapse() {
        this._collapsed = !this._collapsed;
        console.log('[MediaPlayer] Collapsed:', this._collapsed);

        // Save to localStorage
        localStorage.setItem('media-player-collapsed', JSON.stringify(this._collapsed));
    }

    _toggleSettings() {
        this._showingSettings = !this._showingSettings;
        console.log('[MediaPlayer] Settings:', this._showingSettings);
    }

    _startDrag(e) {
        // Don't start drag if clicking on a button
        if (e.target.closest('.title-bar-button')) {
            return;
        }

        this._isDragging = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        this._dragStartX = clientX - this._dragOffsetX;
        this._dragStartY = clientY - this._dragOffsetY;

        // Prevent text selection during drag
        e.preventDefault();

        // Add global event listeners
        const handleMove = (moveEvent) => this._handleDrag(moveEvent);
        const handleEnd = () => this._endDrag(handleMove, handleEnd);

        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleEnd);
        document.addEventListener('touchmove', handleMove);
        document.addEventListener('touchend', handleEnd);
    }

    _handleDrag(e) {
        if (!this._isDragging) return;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        this._dragOffsetX = clientX - this._dragStartX;
        this._dragOffsetY = clientY - this._dragStartY;

        this._applyPosition();
    }

    _endDrag(handleMove, handleEnd) {
        this._isDragging = false;

        // Remove global event listeners
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleEnd);
        document.removeEventListener('touchmove', handleMove);
        document.removeEventListener('touchend', handleEnd);

        // Save position to localStorage
        localStorage.setItem('media-player-position', JSON.stringify({
            x: this._dragOffsetX,
            y: this._dragOffsetY
        }));
    }

    _applyPosition() {
        // Position is now applied directly in the template via style binding
        // Just trigger a re-render
        this.requestUpdate();
    }

    _isCurrentSongActive() {
        return this._activeSongKey === this.currentKey &&
               this._activeSongBpm === this.bpm &&
               this._activeSongTempoNote === this.tempoNote &&
               this._activeSongTimeSignature === this.timeSignature;
    }

    async _crossfadeToNewSong() {
        console.log('[MediaPlayer] Crossfading to new song');

        const oldAudio = this._audio;
        const oldPadGain = this._padGain;
        const padUrl = await this._resolvePadUrlForKey(this.currentKey);
        if (!padUrl) {
            console.warn('[MediaPlayer] Unable to crossfade pads: no pad audio for current key');
            await this._fadeOut();
            this._padLoadFailed = true;
            return;
        }

        // Create new audio element for the new key
        this._audio = this._createPadAudioElement();

        // Create new Web Audio nodes
        const newPadSource = this._audioContext.createMediaElementSource(this._audio);
        this._padGain = this._audioContext.createGain();
        this._padGain.gain.value = 0; // Start silent

        // Connect new audio
        newPadSource.connect(this._padGain);
        this._updateAudioRouting();

        // Update source to new key
        this._audio.src = padUrl;
        this._padLoadFailed = false;

        // Start playing the new audio
        try {
            await this._audio.play();
            this._padsOn = true;
        } catch (e) {
            console.error('[MediaPlayer] Failed to start new audio:', e);
            this._padLoadFailed = true;
            await this._fadeOutPadGain(oldPadGain, oldAudio);
            return;
        }

        // Crossfade: fade out old, fade in new
        const fadeDuration = 2000; // 2 seconds
        const fadeSteps = 50;
        const fadeInterval = fadeDuration / fadeSteps;

        let step = 0;
        const crossfadeInterval = setInterval(() => {
            step++;
            const progress = step / fadeSteps;

            // Fade out old
            if (oldPadGain) {
                oldPadGain.gain.value = this._padVolume * (1 - progress);
            }

            // Fade in new
            this._padGain.gain.value = this._padVolume * progress;

            if (step >= fadeSteps) {
                clearInterval(crossfadeInterval);

                // Clean up old audio
                if (oldAudio) {
                    oldAudio.pause();
                    oldAudio.currentTime = 0;
                }

                console.log('[MediaPlayer] Crossfade complete');
            }
        }, fadeInterval);
    }

    async _togglePlay() {
        if (!this.currentKey) {
            console.warn('[MediaPlayer] No key set, cannot play');
            return;
        }

        // If currently fading, interrupt and switch direction
        if (this._fadingIn || this._fadingOut) {
            console.log('[MediaPlayer] Interrupting current fade to switch direction');
            const wasFadingIn = this._fadingIn;
            const wasFadingOut = this._fadingOut;

            // Clear the current fade interval
            if (this._fadeInterval) {
                clearInterval(this._fadeInterval);
                this._fadeInterval = null;
            }
            // Reset fading states
            this._fadingIn = false;
            this._fadingOut = false;

            // Do the opposite of what we were doing
            if (wasFadingOut) {
                await this._fadeIn();
            } else if (wasFadingIn) {
                await this._fadeOut();
            }
            return;
        }

        if (this._padsOn) {
            await this._fadeOut();
        } else {
            await this._fadeIn();
        }
    }

    async _fadeIn() {
        if (!this._audio) {
            console.error('[MediaPlayer] _fadeIn called but _audio is null!');
            return;
        }

        console.log('[MediaPlayer] Fading in, audio src:', this._audio.src);

        // Resume AudioContext if suspended (required for autoplay policies)
        if (this._audioContext && this._audioContext.state === 'suspended') {
            console.log('[MediaPlayer] Resuming AudioContext');
            await this._audioContext.resume();
        }

        // Clear any existing fade interval
        if (this._fadeInterval) {
            clearInterval(this._fadeInterval);
            this._fadeInterval = null;
        }

        this._fadingIn = true;
        this._padsOn = true;

        // Check if audio is already playing (e.g., interrupted from fade-out)
        const alreadyPlaying = !this._audio.paused;
        const startVolume = this._padGain.gain.value;

        if (!alreadyPlaying) {
            // Start playing at volume 0
            this._padGain.gain.value = 0;
            try {
                await this._audio.play();
            } catch (error) {
                console.error('[MediaPlayer] Play failed:', error);
                this._fadingIn = false;
                this._padLoadFailed = true;
                return;
            }

            // Wait for audio to actually start playing
            // This ensures we don't start fading in before audio has buffered
            await new Promise((resolve) => {
                const handlePlaying = () => {
                    this._audio.removeEventListener('playing', handlePlaying);
                    resolve();
                };

                // If already playing, resolve immediately
                if (!this._audio.paused && this._audio.currentTime > 0) {
                    resolve();
                } else {
                    this._audio.addEventListener('playing', handlePlaying);
                    // Timeout fallback in case 'playing' event doesn't fire
                    setTimeout(resolve, 200);
                }
            });
        } else {
            console.log('[MediaPlayer] Audio already playing at volume', startVolume);
        }

        // Fade in over _fadeDuration using exponential curve
        // Start from current volume (may be mid-fade)
        const currentVolume = this._padGain.gain.value;
        const volumeRange = this._padVolume - currentVolume;
        const steps = 60; // 60 steps for smooth fade
        const stepDuration = this._fadeDuration / steps;

        let currentStep = 0;
        this._fadeInterval = setInterval(() => {
            currentStep++;
            // Use exponential curve: progress^2 for smooth fade-in
            const progress = currentStep / steps;
            const newVolume = Math.min(currentVolume + (volumeRange * (progress * progress)), this._padVolume);
            this._padGain.gain.value = newVolume;

            if (currentStep >= steps || newVolume >= this._padVolume) {
                clearInterval(this._fadeInterval);
                this._fadeInterval = null;
                this._padGain.gain.value = this._padVolume; // Ensure we hit target
                this._fadingIn = false;
                console.log('[MediaPlayer] Fade in complete');
            }
        }, stepDuration);
    }

    async _fadeOut() {
        if (!this._audio) return;

        console.log('[MediaPlayer] Fading out');
        this._fadingOut = true;

        // Clear any existing fade interval
        if (this._fadeInterval) {
            clearInterval(this._fadeInterval);
            this._fadeInterval = null;
        }

        // Fade out over _fadeDuration using exponential curve
        const steps = 60;
        const stepDuration = this._fadeDuration / steps;
        const startVolume = this._padGain.gain.value;

        let currentStep = 0;
        return new Promise((resolve) => {
            this._fadeInterval = setInterval(() => {
                currentStep++;
                // Use inverse exponential curve: (1-progress)^2 for smooth fade-out
                const progress = currentStep / steps;
                const remaining = 1 - progress;
                const newVolume = Math.max(startVolume * (remaining * remaining), 0);
                this._padGain.gain.value = newVolume;

                // Complete when we've done all steps or volume is effectively zero
                if (currentStep >= steps || newVolume < 0.01) {
                    clearInterval(this._fadeInterval);
                    this._fadeInterval = null;
                    this._padGain.gain.value = 0; // Ensure it's actually zero
                    this._audio.pause();
                    this._fadingOut = false;
                    console.log('[MediaPlayer] Fade out complete');
                    resolve();
                }
            }, stepDuration);
        });
    }

    _fadeOutPadGain(padGain, audioElement) {
        if (!padGain || !audioElement) {
            return Promise.resolve();
        }

        const steps = 60;
        const stepDuration = this._fadeDuration / steps;
        const startVolume = padGain.gain.value;

        return new Promise((resolve) => {
            let currentStep = 0;
            const interval = setInterval(() => {
                currentStep++;
                const progress = currentStep / steps;
                const remaining = 1 - progress;
                const newVolume = Math.max(startVolume * (remaining * remaining), 0);
                padGain.gain.value = newVolume;

                if (currentStep >= steps || newVolume < 0.01) {
                    clearInterval(interval);
                    padGain.gain.value = 0;
                    try {
                        audioElement.pause();
                        audioElement.currentTime = 0;
                    } catch (err) {
                        console.debug('[MediaPlayer] Unable to pause old pad audio during fallback fade:', err);
                    }
                    resolve();
                }
            }, stepDuration);
        });
    }

    async _crossfadeToNewKey() {
        console.log('[MediaPlayer] Crossfading to new key:', this.currentKey);

        // Clear any existing fade interval
        if (this._fadeInterval) {
            clearInterval(this._fadeInterval);
            this._fadeInterval = null;
        }

        // Set fading state
        this._fadingOut = true;
        this._fadingIn = true;

        const newUrl = await this._resolvePadUrlForKey(this.currentKey);
        if (!newUrl) {
            console.warn('[MediaPlayer] Unable to crossfade to new key: no pad audio available');
            this._fadingOut = false;
            this._fadingIn = false;
            this._padLoadFailed = true;
            return;
        }

        // Create a new Audio element for the new key
        const newAudio = this._createPadAudioElement();
        newAudio.src = newUrl;
        this._padLoadFailed = false;

        // Create Web Audio nodes for new audio
        const newSource = this._audioContext.createMediaElementSource(newAudio);
        const newGain = this._audioContext.createGain();
        newGain.gain.value = 0; // Start silent

        // Connect new audio through gain to destination
        newSource.connect(newGain);
        newGain.connect(this._audioContext.destination);

        // Keep reference to old audio and gain
        const oldAudio = this._audio;
        const oldGain = this._padGain;

        // Wait for new audio to be loaded enough to play through
        await new Promise((resolve, reject) => {
            const handleCanPlayThrough = () => {
                newAudio.removeEventListener('canplaythrough', handleCanPlayThrough);
                newAudio.removeEventListener('error', handleError);
                resolve();
            };
            const handleError = (e) => {
                newAudio.removeEventListener('canplaythrough', handleCanPlayThrough);
                newAudio.removeEventListener('error', handleError);
                reject(e);
            };

            if (newAudio.readyState >= 4) { // HAVE_ENOUGH_DATA
                resolve();
            } else {
                newAudio.addEventListener('canplaythrough', handleCanPlayThrough);
                newAudio.addEventListener('error', handleError);
            }
        });

        console.log('[MediaPlayer] New audio loaded, starting playback');

        // Now start playing the new audio at volume 0
        try {
            await newAudio.play();
        } catch (error) {
            console.error('[MediaPlayer] Failed to play new audio:', error);
            this._fadingOut = false;
            this._fadingIn = false;
            return;
        }

        console.log('[MediaPlayer] New audio playing, starting crossfade');

        // Switch to the new audio element and gain
        this._audio = newAudio;
        this._padSource = newSource;
        this._padGain = newGain;

        // Crossfade strategy: 5s fade-out + 5s fade-in with 1s overlap = 9s total
        // Timeline:
        // 0-4s: Old fades out only
        // 4-5s: Both playing (1s overlap)
        // 5-9s: New fades in only
        const fadeOutDuration = this._fadeDuration; // 5s
        const fadeInDuration = this._fadeDuration; // 5s
        const overlapDuration = 1000; // 1s
        const totalDuration = fadeOutDuration + fadeInDuration - overlapDuration; // 9s

        const steps = 60;
        const stepDuration = totalDuration / steps;
        const oldStartVolume = oldGain.gain.value;

        // Calculate step boundaries
        const fadeOutSteps = Math.floor((fadeOutDuration / totalDuration) * steps); // ~33 steps for 5s
        const fadeInStartStep = Math.floor(((fadeOutDuration - overlapDuration) / totalDuration) * steps); // ~27 steps (4s mark)

        let currentStep = 0;
        this._fadeInterval = setInterval(() => {
            currentStep++;
            const totalProgress = currentStep / steps;

            // Fade out old audio over first 5 seconds
            if (currentStep <= fadeOutSteps) {
                const fadeOutProgress = currentStep / fadeOutSteps;
                const remaining = 1 - fadeOutProgress;
                const oldVolume = Math.max(oldStartVolume * (remaining * remaining), 0);
                oldGain.gain.value = oldVolume;
            } else {
                // Old audio finished fading, stop it
                if (oldGain.gain.value > 0) {
                    oldGain.gain.value = 0;
                    oldAudio.pause();
                }
            }

            // Fade in new audio starting at 4 seconds (1s overlap with old)
            if (currentStep >= fadeInStartStep) {
                const fadeInProgress = (currentStep - fadeInStartStep) / (steps - fadeInStartStep);
                const newVolume = Math.min(this._padVolume * (fadeInProgress * fadeInProgress), this._padVolume);
                newGain.gain.value = newVolume;
            }

            if (currentStep >= steps) {
                clearInterval(this._fadeInterval);
                this._fadeInterval = null;

                // Cleanup old audio
                oldAudio.pause();
                oldGain.gain.value = 0;
                oldGain.disconnect();

                // Ensure new audio is at target volume
                newGain.gain.value = this._padVolume;

                // Update routing for stereo split if enabled
                this._updateAudioRouting();

                // Clear fading state
                this._fadingOut = false;
                this._fadingIn = false;

                console.log('[MediaPlayer] Crossfade complete (9s)');
            }
        }, stepDuration);
    }

    _getStatusText() {
        if (this._fadingIn) return 'Fading in...';
        if (this._fadingOut) return 'Fading out...';
        if (this._padsOn) return 'Playing';
        return 'Stopped';
    }

    _startVolumeControl(e, type) {
        e.preventDefault();
        e.stopPropagation();

        // Get initial touch/click position
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        // Position slider near the touch point
        this._sliderX = clientX;
        this._sliderY = clientY;
        this._activeVolumeControl = type;
        this._showingVolumeSlider = true;

        // Add move/end listeners
        const handleMove = (moveEvent) => {
            this._handleVolumeMove(moveEvent);
        };

        const handleEnd = () => {
            this._showingVolumeSlider = false;
            this._activeVolumeControl = null;
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleEnd);
            document.removeEventListener('touchmove', handleMove);
            document.removeEventListener('touchend', handleEnd);
            this.requestUpdate();
        };

        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleEnd);
        document.addEventListener('touchmove', handleMove);
        document.addEventListener('touchend', handleEnd);
    }

    _handleVolumeMove(e) {
        if (!this._activeVolumeControl) return;

        e.preventDefault();

        // Get vertical position relative to initial touch
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        // Calculate delta from start (negative = up, positive = down)
        const delta = this._sliderY - clientY;

        // Convert to percentage change (200px = full range)
        const change = delta / 200;

        // Get current volume
        const currentVolume = this._activeVolumeControl === 'pad' ? this._padVolume : this._clickVolume;

        // Calculate new volume
        const newVolume = Math.max(0, Math.min(1, currentVolume + change));

        // Update volume
        if (this._activeVolumeControl === 'pad') {
            this._padVolume = newVolume;
            // Update current audio gain if playing AND not currently fading
            // If fading, just update the target - the fade will reach the new target
            if (this._padGain && this._padsOn && !this._fadingIn && !this._fadingOut) {
                this._padGain.gain.value = this._padVolume;
            }
            // Save to localStorage
            localStorage.setItem('setalight-pad-volume', this._padVolume.toString());
        } else if (this._activeVolumeControl === 'click') {
            this._clickVolume = newVolume;
            // Update metronome gain if active
            if (this._clickGain) {
                this._clickGain.gain.value = this._clickVolume;
            }
            // Save to localStorage
            localStorage.setItem('setalight-click-volume', this._clickVolume.toString());
        }

        // Update slider Y position for next calculation
        this._sliderY = clientY;

        this.requestUpdate();
    }

    render() {
        const padsPlaying = this._audio && !this._audio.paused;
        const clickPlaying = this._metronomeRunning;
        const isPlaying = padsPlaying || clickPlaying;
        const isDownloading = this._isPadLoading;
        const statusText = isDownloading ? 'DOWNLOAD' : (isPlaying ? 'PLAYING' : 'STOPPED');
        const statusClass = isDownloading ? 'status-downloading' : '';

        // Check if we're viewing a different song than what's playing
        // Compare song IDs instead of individual properties
        const viewingDifferentSong = this._currentSongId && this._activeSongId &&
            this._currentSongId !== this._activeSongId;

        // Show Next column data if: we have a current song ID AND (nothing is active OR viewing different song)
        const showNextData = this._currentSongId && (!this._activeSongId || viewingDifferentSong);

        const showPadError = this._padLoadFailed && !!this._activeSongKey;
        const activeKeyDisplay = showPadError ? html`
            <help-tooltip message="Could not load pad sound for this key">
                ${this._activeSongKey}!
            </help-tooltip>
        ` : (this._activeSongKey || '-');

        // If collapsed, show just the expand button (always bottom-left)
        if (this._collapsed) {
            return html`
                <button
                    class="collapsed-button"
                    @click=${this._toggleCollapse}
                    title="Expand player"
                >
                    ▶
                </button>
            `;
        }

        return html`
            <!-- Settings modal (outside container so it's not constrained) -->
            ${this._showingSettings ? html`
                <div class="settings-modal" @click=${this._toggleSettings}>
                    <div class="settings-content" @click=${(e) => e.stopPropagation()}>
                        <div class="settings-header">
                            <div class="settings-title">Media Player Settings</div>
                            <button class="close-button" @click=${this._toggleSettings} aria-label="Close">×</button>
                        </div>
                        <media-player-settings
                            .mediaPlayerEnabled=${true}
                            .padsEnabled=${this._padsEnabled}
                            .metronomeEnabled=${this._metronomeGlobalEnabled}
                            .stereoSplitEnabled=${this.stereoSplitEnabled}
                            @settings-change=${(e) => {
                                console.log('[MediaPlayer] Settings changed from modal:', e.detail);
                                // Save to localStorage
                                localStorage.setItem('mediaPlayerSettings', JSON.stringify(e.detail));
                                // Update our local state
                                this._padsEnabled = e.detail.padsEnabled !== false;
                                this._metronomeGlobalEnabled = e.detail.metronomeEnabled !== false;
                                this.stereoSplitEnabled = e.detail.stereoSplitEnabled === true;
                                // Dispatch to sync with global settings
                                window.dispatchEvent(new CustomEvent('media-player-settings-changed', {
                                    detail: e.detail
                                }));
                                this._updateAudioRouting();
                                this.requestUpdate();
                            }}
                        ></media-player-settings>
                    </div>
                </div>
            ` : ''}

            <div class="player" part="player" style="transform: translate(${this._dragOffsetX}px, ${this._dragOffsetY}px);">
                <!-- Title bar -->
                <div class="title-bar" @mousedown=${this._startDrag} @touchstart=${this._startDrag}>
                    <div class="title-bar-content">
                        ${this._activeSongTitle || 'Media Player'}
                    </div>
                    <div class="title-bar-buttons">
                        <button class="title-bar-button" @click=${this._toggleSettings} title="Settings">⚙</button>
                        <button class="title-bar-button" @click=${this._toggleCollapse} title="Minimize">▼</button>
                    </div>
                </div>

                <!-- Container with grid layout -->
                <div class="container" part="container">
                    <!-- Row 1, Column 1: LED display -->
                ${(this._padsEnabled || this._metronomeGlobalEnabled) ? html`
                    <div class="led-display-section">
                        <div class="led-display">
                            <!-- Row 1: Headers -->
                            <div class="led-label"></div>
                            <div class="led-value led-header ${statusClass}">${statusText}</div>
                            <div class="led-value led-header">Next</div>

                            <!-- Row 2: Key -->
                            <div class="led-label">Key</div>
                            <div class="led-value ${showPadError ? 'pad-error' : ''}">${activeKeyDisplay}</div>
                            <div class="led-value">${showNextData ? (this.currentKey || '-') : '-'}</div>

                            <!-- Row 3: BPM -->
                            <div class="led-label">BPM</div>
                            <div class="led-value">${this._activeSongBpm || '-'}</div>
                            <div class="led-value">${showNextData ? (this._currentBpm || '-') : '-'}</div>

                            <!-- Row 4: Time -->
                            <div class="led-label">Time</div>
                            <div class="led-value">${this._activeSongTimeSignature || '-'}</div>
                            <div class="led-value">${showNextData ? (this._currentTimeSignature || '-') : '-'}</div>
                        </div>
                    </div>
                ` : ''}

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
                            ▶
                        </button>
                        <button
                            class="stop-button"
                            part="stop-button"
                            @click=${this._stop}
                            aria-label="Stop (Escape)"
                            title="Stop - Press Escape"
                        >
                            ⏹
                        </button>
                    </div>
                </div>

                <!-- Divider spanning both rows -->
                ${(this._padsEnabled || this._metronomeGlobalEnabled) ? html`
                    <div class="divider"></div>
                ` : ''}

                <!-- Row 1, Column 3: Volume knobs -->
                ${(this._padsEnabled || this._metronomeGlobalEnabled) ? html`
                    <div class="knobs-section">
                        <div class="knobs-row">
                            ${this._padsEnabled ? html`
                                <div class="knob-column">
                                    <div class="knob-label">Pads</div>
                                    <div
                                        class="volume-knob ${this._activeVolumeControl === 'pad' ? 'dragging' : ''}"
                                        @mousedown=${(e) => this._startVolumeControl(e, 'pad')}
                                        @touchstart=${(e) => this._startVolumeControl(e, 'pad')}
                                        title="Pad Volume"
                                    >
                                        <div class="volume-indicator" style="transform: rotate(${(this._padVolume - 0.5) * 270}deg)"></div>
                                        <div class="volume-value">${Math.round(this._padVolume * 11)}</div>
                                    </div>
                                    <div class="toggle-label">${this._padsOn ? 'On' : 'Off'}</div>
                                </div>
                            ` : ''}
                            ${this._metronomeGlobalEnabled ? html`
                                <div class="knob-column">
                                    <div class="knob-label">Click</div>
                                    <div
                                        class="volume-knob ${this._activeVolumeControl === 'click' ? 'dragging' : ''}"
                                        @mousedown=${(e) => this._startVolumeControl(e, 'click')}
                                        @touchstart=${(e) => this._startVolumeControl(e, 'click')}
                                        title="Click Volume"
                                    >
                                        <div class="volume-indicator" style="transform: rotate(${(this._clickVolume - 0.5) * 270}deg)"></div>
                                        <div class="volume-value">${Math.round(this._clickVolume * 11)}</div>
                                    </div>
                                    <div class="toggle-label">${this._clickOn ? 'On' : 'Off'}</div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}

                <!-- Row 2, Column 3: LED toggle buttons -->
                ${(this._padsEnabled || this._metronomeGlobalEnabled) ? html`
                    <div class="toggles-section">
                        <div class="cassette-buttons">
                            ${this._padsEnabled && this._metronomeGlobalEnabled ? html`
                                <button class="led-button middle ${this._padsOn ? 'active' : ''}" @click=${this._togglePads} title="Toggle pads on/off">
                                    <div class="led-light ${this._padsOn ? 'pads-on' : ''}"></div>
                                </button>
                                <button class="led-button ${this._clickOn ? 'active' : ''}" @click=${this._toggleClick} title="Toggle click on/off">
                                    <div class="led-light ${this._clickOn ? 'click-on' : ''}"></div>
                                </button>
                            ` : this._padsEnabled ? html`
                                <button class="led-button ${this._padsOn ? 'active' : ''}" @click=${this._togglePads} title="Toggle pads on/off">
                                    <div class="led-light ${this._padsOn ? 'pads-on' : ''}"></div>
                                </button>
                            ` : this._metronomeGlobalEnabled ? html`
                                <button class="led-button ${this._clickOn ? 'active' : ''}" @click=${this._toggleClick} title="Toggle click on/off">
                                    <div class="led-light ${this._clickOn ? 'click-on' : ''}"></div>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}
                </div><!-- End container -->
            </div><!-- End player -->
        `;
    }
}

// Define the custom element
customElements.define('media-player', MediaPlayer);
