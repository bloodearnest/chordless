import { LitElement, html, css } from 'lit';

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
        // Current song metadata (from song-change event, updated on swipe)
        _currentBpm: { type: Number, state: true },
        _currentTempoNote: { type: String, state: true },
        _currentTimeSignature: { type: String, state: true },
        // Active song metadata (loaded in player, only updated when play is pressed)
        _activeSongKey: { type: String, state: true }, // The song key currently loaded in media player
        _activeSongBpm: { type: Number, state: true },
        _activeSongTempoNote: { type: String, state: true },
        _activeSongTimeSignature: { type: String, state: true }
    };

    static styles = css`
        :host {
            display: inline-block;
        }

        .container {
            display: flex;
            align-items: center;
            gap: 0.9rem;
            padding: 1.2rem;
            background: var(--player-bg, #34495e);
            border-radius: 10px;
            color: var(--player-text, white);
            width: fit-content;
        }

        .play-button {
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

        .play-button:hover {
            background: rgba(255, 255, 255, 0.1);
            transform: scale(1.05);
        }

        .play-button:active {
            transform: scale(0.95);
        }

        .play-button.playing {
            background: var(--player-text, white);
            color: var(--player-bg, #34495e);
        }

        .play-button:disabled {
            opacity: 0.3;
            cursor: not-allowed;
        }

        .play-button:disabled:hover {
            background: transparent;
            transform: none;
        }

        .play-button.playing:disabled:hover {
            background: var(--player-text, white);
            transform: none;
        }

        .stop-button {
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

        .stop-button:hover {
            background: rgba(255, 255, 255, 0.1);
            transform: scale(1.05);
        }

        .stop-button:active {
            transform: scale(0.95);
        }

        .stop-button:disabled {
            opacity: 0.3;
            cursor: not-allowed;
        }

        .stop-button:disabled:hover {
            background: transparent;
            transform: none;
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

        .toggle-button:hover {
            background: rgba(255, 255, 255, 0.1);
            transform: scale(1.05);
        }

        .toggle-button:active {
            transform: scale(0.95);
        }

        .toggle-button.active {
            background: #27ae60;
            border-color: #27ae60;
            color: white;
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

        .metronome-button:hover {
            background: rgba(255, 255, 255, 0.1);
            transform: scale(1.05);
        }

        .metronome-button:active {
            transform: scale(0.95);
        }

        .metronome-button.active {
            background: #3498db;
            border-color: #3498db;
            color: white;
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

        .split-button:hover {
            background: rgba(255, 255, 255, 0.1);
            transform: scale(1.05);
        }

        .split-button:active {
            transform: scale(0.95);
        }

        .split-button.active {
            background: #9b59b6;
            border-color: #9b59b6;
            color: white;
        }

        .volume-control-item {
            position: relative;
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
            font-size: 0.9rem;
            font-weight: 600;
            user-select: none;
            touch-action: none;
            box-sizing: border-box;
            transition: all 0.2s;
        }

        .volume-control-item:hover {
            background: rgba(255, 255, 255, 0.1);
            transform: scale(1.05);
        }

        .volume-control-item:active {
            transform: scale(0.95);
        }

        .volume-control-item.dragging {
            background: rgba(255, 255, 255, 0.2);
        }

        .control-group {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.6rem;
        }

        .control-group-buttons {
            display: flex;
            gap: 0.6rem;
        }

        .control-group-label {
            font-size: 0.84rem;
            font-weight: 600;
            color: var(--player-text, white);
            opacity: 0.7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .control-group-info {
            font-size: 0.96rem;
            color: var(--player-text, white);
            opacity: 0.7;
            text-align: center;
            margin-top: 0.12rem;
        }

        .vertical-slider {
            position: fixed;
            width: 60px;
            height: 200px;
            background: var(--player-bg, #34495e);
            border: 2px solid var(--player-text, white);
            border-radius: 30px;
            padding: 10px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            z-index: 10000;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.15s;
        }

        .vertical-slider.visible {
            opacity: 1;
            pointer-events: auto;
        }

        .vertical-slider-track {
            width: 100%;
            height: 100%;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 20px;
            position: relative;
            overflow: hidden;
        }

        .vertical-slider-fill {
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            background: var(--player-text, white);
            border-radius: 20px;
            transition: height 0.05s;
        }

        .vertical-slider-value {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 1.2rem;
            font-weight: bold;
            color: var(--player-bg, #34495e);
            text-shadow: 0 0 3px rgba(255, 255, 255, 0.8);
            z-index: 1;
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
        // If only one feature is enabled, it should always be "on" (no toggle needed)
        const bothEnabled = this._padsEnabled && this._metronomeGlobalEnabled;
        this._padsOn = bothEnabled ? false : this._padsEnabled; // Always on if pads are the only feature
        this._clickOn = bothEnabled ? false : this._metronomeGlobalEnabled; // Always on if click is the only feature

        // Active song state (what's currently loaded in the player)
        this._activeSongKey = null;
        this._activeSongBpm = null;
        this._activeSongTempoNote = null;
        this._activeSongTimeSignature = null;

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
    }

    connectedCallback() {
        super.connectedCallback();
        this._initAudio();
        this._boundHandleKeydown = this._handleKeydown.bind(this);
        this._boundHandleSettingsChange = this._handleSettingsChange.bind(this);
        this._boundHandleSongChange = this._handleSongChange.bind(this);
        document.addEventListener('keydown', this._boundHandleKeydown);
        document.addEventListener('settings-change', this._boundHandleSettingsChange);
        document.addEventListener('song-change', this._boundHandleSongChange);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._cleanup();
        document.removeEventListener('keydown', this._boundHandleKeydown);
        document.removeEventListener('settings-change', this._boundHandleSettingsChange);
        document.removeEventListener('song-change', this._boundHandleSongChange);
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
        const { key, bpm, tempoNote, timeSignature, title } = event.detail;
        console.log('[MediaPlayer] Song changed:', { key, bpm, tempoNote, timeSignature, title });

        // Update current song metadata (stored but not activated until play is pressed)
        if (key) {
            this.currentKey = key;
        }
        // Store current song's tempo/time signature metadata
        this._currentBpm = bpm || null;
        this._currentTempoNote = tempoNote || '1/4';
        this._currentTimeSignature = timeSignature || null;
    }

    updated(changedProperties) {
        super.updated(changedProperties);

        // Handle key changes - just update the source, don't auto-switch
        if (changedProperties.has('currentKey') && this.currentKey && !this._padsOn) {
            // Update the source without playing (pre-load for quick start)
            this._updateAudioSource();
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

            this._audio = new Audio();
            this._audio.loop = true;
            this._audio.crossOrigin = 'anonymous';

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

            // Handle audio errors
            this._audio.addEventListener('error', (e) => {
                console.error('[MediaPlayer] Audio error:', e);
                this._padsOn = false;
                this._fadingIn = false;
                this._fadingOut = false;
            });

            // Update source if we have a key
            if (this.currentKey) {
                this._updateAudioSource();
            }
        }
    }

    _updateAudioSource() {
        if (!this._audio || !this.currentKey) return;

        const url = `/pads/${encodeURIComponent(this.currentKey)} - WARM - CHURCHFRONT PADS.mp3`;
        console.log('[MediaPlayer] Setting audio source:', url);
        this._audio.src = url;
    }

    _cleanup() {
        if (this._fadeInterval) {
            clearInterval(this._fadeInterval);
            this._fadeInterval = null;
        }
        if (this._audio) {
            this._audio.pause();
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

        // Check what's actually playing
        const padsPlaying = this._audio && !this._audio.paused;
        const clickPlaying = this._metronomeInterval !== null;

        // Stop click immediately if playing (but don't change toggle state)
        if (clickPlaying) {
            this._stopMetronome();
        }

        // Fade out pads if playing (but don't change toggle state)
        if (padsPlaying) {
            await this._fadeOut();
        }

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
        if (!this.bpm || !this.timeSignature) {
            console.warn('[MediaPlayer] Cannot start metronome: missing BPM or time signature');
            return;
        }

        // Ensure audio is initialized (this will create _audioContext and _clickGain)
        this._initAudio();

        // Resume AudioContext if suspended
        if (this._audioContext.state === 'suspended') {
            this._audioContext.resume();
        }

        // Update gain to current volume setting
        this._clickGain.gain.value = this._clickVolume;

        // Cannot start metronome without active song metadata
        if (!this._activeSongBpm || !this._activeSongTimeSignature) {
            console.warn('[MediaPlayer] Cannot start metronome: no active song with tempo/time signature');
            return;
        }

        const timeSignature = this._activeSongTimeSignature;
        const tempoNote = this._activeSongTempoNote || '1/4';
        const bpm = this._activeSongBpm;

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

        // Start the metronome scheduling loop
        // Play first click immediately, then schedule subsequent clicks
        this._playClick();
        this._scheduleNextClick();
    }

    _scheduleNextClick() {
        if (!this._beatInterval) return;

        // Use setTimeout for the next click
        // This ensures consistent timing even if _playClick() takes some time to execute
        this._metronomeInterval = setTimeout(() => {
            this._playClick();
            this._scheduleNextClick(); // Schedule the next one
        }, this._beatInterval);
    }

    _stopMetronome() {
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
        const wasPlayingClick = this._clickOn && oldActiveBpm && this._metronomeInterval;

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

        // Set this as the active song BEFORE starting pads/click
        // This ensures the metronome has access to the tempo/time signature
        this._activeSongKey = this.currentKey;
        this._activeSongBpm = this._currentBpm;
        this._activeSongTempoNote = this._currentTempoNote;
        this._activeSongTimeSignature = this._currentTimeSignature;

        // Handle pads: crossfade if key changed and pads toggle is on
        if (needsKeyChange && this._padsOn && wasPlayingPads) {
            console.log('[MediaPlayer] Crossfading pads from', this._activeSongKey, 'to', this.currentKey);
            await this._crossfadeToNewSong();
        } else if (this._padsOn && !wasPlayingPads) {
            // Pads toggle is on but not playing yet, start them
            console.log('[MediaPlayer] Starting pads for first time, _padsOn =', this._padsOn);
            this._updateAudioSource(); // Set the audio source before playing
            await this._fadeIn();
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
            this._updateAudioSource();
        }

        // Handle click: stop, wait 1s, restart with new tempo if needed
        if (needsTempoChange && this._clickOn && wasPlayingClick) {
            console.log('[MediaPlayer] Restarting click with new tempo:', this._currentBpm);
            this._stopMetronome();
            // Wait 1 second before restarting
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (this._clickOn) {  // Check again in case user toggled off during wait
                this._startMetronome();
            }
        } else if (this._clickOn && !wasPlayingClick) {
            // Click toggle is on but not playing yet, start it
            console.log('[MediaPlayer] Starting click for first time');
            this._startMetronome();
        } else if (!this._clickOn && wasPlayingClick) {
            // Click toggle was turned off while playing, stop it
            console.log('[MediaPlayer] Click toggle off, stopping');
            this._stopMetronome();
        }

        // Active song properties already set at the beginning of this method
    }

    _togglePads() {
        this._padsOn = !this._padsOn;
        console.log('[MediaPlayer] Pads toggle:', this._padsOn);

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

    _isCurrentSongActive() {
        return this._activeSongKey === this.currentKey &&
               this._activeSongBpm === this.bpm &&
               this._activeSongTempoNote === this.tempoNote &&
               this._activeSongTimeSignature === this.timeSignature;
    }

    async _crossfadeToNewSong() {
        console.log('[MediaPlayer] Crossfading to new song');

        // Store the old audio element
        const oldAudio = this._audio;
        const oldPadGain = this._padGain;

        // Create new audio element for the new key
        this._audio = new Audio();
        this._audio.loop = true;
        this._audio.crossOrigin = 'anonymous';

        // Create new Web Audio nodes
        const newPadSource = this._audioContext.createMediaElementSource(this._audio);
        this._padGain = this._audioContext.createGain();
        this._padGain.gain.value = 0; // Start silent

        // Connect new audio
        newPadSource.connect(this._padGain);
        this._updateAudioRouting();

        // Update source to new key
        this._updateAudioSource();

        // Start playing the new audio
        try {
            await this._audio.play();
            this._padsOn = true;
        } catch (e) {
            console.error('[MediaPlayer] Failed to start new audio:', e);
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
                this._padsOn = false;
                this._fadingIn = false;
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
                    this._padsOn = false;
                    this._fadingOut = false;
                    console.log('[MediaPlayer] Fade out complete');
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

        // Create a new Audio element for the new key
        const newAudio = new Audio();
        newAudio.loop = true;
        newAudio.crossOrigin = 'anonymous';
        const newUrl = `/pads/${encodeURIComponent(this.currentKey)} - WARM - CHURCHFRONT PADS.mp3`;
        newAudio.src = newUrl;

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
        const clickPlaying = this._metronomeInterval !== null;
        const isPlaying = padsPlaying || clickPlaying;

        // Show toggle buttons only if BOTH features are enabled
        const showToggles = this._padsEnabled && this._metronomeGlobalEnabled;

        return html`
            <div class="container" part="container">
                <div class="control-group">
                    <div class="control-group-label">Song</div>
                    <div class="control-group-info">${isPlaying ? 'Playing' : 'Stopped'}</div>
                    <div class="control-group-buttons">
                        <button
                            class="play-button"
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
                            ?disabled=${!isPlaying}
                        >
                            ⏹
                        </button>
                    </div>
                </div>

                ${this._padsEnabled ? html`
                    <div class="control-group">
                        <div class="control-group-label">Pads</div>
                        <div class="control-group-info">${this._activeSongKey || this.currentKey || '-'}</div>
                        <div class="control-group-buttons">
                            ${showToggles ? html`
                                <button
                                    class="toggle-button ${this._padsOn ? 'active' : ''}"
                                    @click=${this._togglePads}
                                    aria-label="Toggle pads"
                                    title="Toggle pads on/off"
                                >
                                    ${this._padsOn ? 'ON' : 'OFF'}
                                </button>
                            ` : ''}
                            <div
                                class="volume-control-item ${this._activeVolumeControl === 'pad' ? 'dragging' : ''}"
                                @mousedown=${(e) => this._startVolumeControl(e, 'pad')}
                                @touchstart=${(e) => this._startVolumeControl(e, 'pad')}
                                title="Pad Volume"
                            >
                                ${Math.round(this._padVolume * 100)}%
                            </div>
                        </div>
                    </div>
                ` : ''}

                ${this._metronomeGlobalEnabled ? html`
                    <div class="control-group">
                        <div class="control-group-label">Click</div>
                        <div class="control-group-info">${this._activeSongBpm || '-'} BPM · ${this._activeSongTimeSignature || '-'}</div>
                        <div class="control-group-buttons">
                            ${showToggles ? html`
                                <button
                                    class="toggle-button ${this._clickOn ? 'active' : ''}"
                                    part="click-toggle-button"
                                    @click=${this._toggleClick}
                                    aria-label="Toggle click"
                                    title="Toggle click on/off"
                                >
                                    ${this._clickOn ? 'ON' : 'OFF'}
                                </button>
                            ` : ''}
                            <div
                                class="volume-control-item ${this._activeVolumeControl === 'click' ? 'dragging' : ''}"
                                @mousedown=${(e) => this._startVolumeControl(e, 'click')}
                                @touchstart=${(e) => this._startVolumeControl(e, 'click')}
                                title="Click Volume"
                            >
                                ${Math.round(this._clickVolume * 100)}%
                            </div>
                        </div>
                    </div>
                ` : ''}
            </div>

            ${this._showingVolumeSlider ? html`
                <div class="vertical-slider visible" style="left: ${this._sliderX}px; top: ${this._sliderY - 100}px;">
                    <div class="vertical-slider-value">
                        ${Math.round((this._activeVolumeControl === 'pad' ? this._padVolume : this._clickVolume) * 100)}%
                    </div>
                    <div class="vertical-slider-track">
                        <div class="vertical-slider-fill" style="height: ${(this._activeVolumeControl === 'pad' ? this._padVolume : this._clickVolume) * 100}%"></div>
                    </div>
                </div>
            ` : ''}
        `;
    }
}

// Define the custom element
customElements.define('media-player', MediaPlayer);
