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
        bpm: { type: Number },
        timeSignature: { type: String, attribute: 'time-signature' },
        playing: { type: Boolean, reflect: true },
        metronomeEnabled: { type: Boolean, state: true },
        stereoSplitEnabled: { type: Boolean, state: true },
        _fadingOut: { type: Boolean, state: true },
        _fadingIn: { type: Boolean, state: true },
        _showingVolumeSlider: { type: Boolean, state: true },
        _padVolume: { type: Number, state: true },
        _clickVolume: { type: Number, state: true },
        _padsEnabled: { type: Boolean, state: true },
        _metronomeGlobalEnabled: { type: Boolean, state: true }
    };

    static styles = css`
        :host {
            display: inline-block;
        }

        .container {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 1rem;
            background: var(--player-bg, #34495e);
            border-radius: 8px;
            color: var(--player-text, white);
            width: fit-content;
        }

        .play-button {
            width: 3rem;
            height: 3rem;
            border-radius: 50%;
            border: 2px solid var(--player-text, white);
            background: transparent;
            color: var(--player-text, white);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.2rem;
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

        .panic-button {
            width: 3rem;
            height: 3rem;
            border-radius: 50%;
            border: 2px solid #e74c3c;
            background: transparent;
            color: #e74c3c;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.2rem;
            line-height: 1;
            box-sizing: border-box;
            transition: all 0.2s;
            font-weight: bold;
        }

        .panic-button:hover {
            background: #e74c3c;
            color: white;
            transform: scale(1.05);
        }

        .panic-button:active {
            transform: scale(0.95);
        }

        .metronome-button {
            width: 3rem;
            height: 3rem;
            border-radius: 50%;
            border: 2px solid var(--player-text, white);
            background: transparent;
            color: var(--player-text, white);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2rem;
            line-height: 1;
            padding-left: 1.5rem;
            padding-bottom: 0.1rem;
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
            width: 3rem;
            height: 3rem;
            border-radius: 50%;
            border: 2px solid var(--player-text, white);
            background: transparent;
            color: var(--player-text, white);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.2rem;
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
            width: 3rem;
            height: 3rem;
            border-radius: 50%;
            border: 2px solid var(--player-text, white);
            background: transparent;
            color: var(--player-text, white);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.75rem;
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
            gap: 0.5rem;
        }

        .control-group-buttons {
            display: flex;
            gap: 0.5rem;
        }

        .control-group-label {
            font-size: 0.7rem;
            font-weight: 600;
            color: var(--player-text, white);
            opacity: 0.7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
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
        this.timeSignature = '4/4';
        this.playing = false;
        this.metronomeEnabled = false;
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
        this._metronomeBeat = 0;
        this._audioContext = null;
        this._clickGain = null;
    }

    connectedCallback() {
        super.connectedCallback();
        this._initAudio();
        this._boundHandleKeydown = this._handleKeydown.bind(this);
        this._boundHandleSettingsChange = this._handleSettingsChange.bind(this);
        document.addEventListener('keydown', this._boundHandleKeydown);
        document.addEventListener('settings-change', this._boundHandleSettingsChange);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._cleanup();
        document.removeEventListener('keydown', this._boundHandleKeydown);
        document.removeEventListener('settings-change', this._boundHandleSettingsChange);
    }

    _handleSettingsChange(event) {
        const settings = event.detail;
        console.log('[MediaPlayer] Settings changed:', settings);

        this._padsEnabled = settings.padsEnabled !== false;
        this._metronomeGlobalEnabled = settings.metronomeEnabled !== false;
        this.stereoSplitEnabled = settings.stereoSplitEnabled === true;

        // Stop metronome if it was disabled globally
        if (!this._metronomeGlobalEnabled && this.metronomeEnabled) {
            this._stopMetronome();
            this.metronomeEnabled = false;
        }

        // Update audio routing
        this._updateAudioRouting();

        this.requestUpdate();
    }

    updated(changedProperties) {
        super.updated(changedProperties);

        // Handle key changes
        if (changedProperties.has('currentKey') && this.currentKey) {
            const oldKey = changedProperties.get('currentKey');
            if (oldKey && oldKey !== this.currentKey && this.playing) {
                // Key changed while playing - crossfade
                this._crossfadeToNewKey();
            } else if (!this.playing) {
                // Just update the source without playing
                this._updateAudioSource();
            }
        }

        // Handle BPM or time signature changes while metronome is running
        if ((changedProperties.has('bpm') || changedProperties.has('timeSignature')) && this.metronomeEnabled) {
            console.log('[MediaPlayer] Tempo/time changed, restarting metronome');
            this._stopMetronome();
            this._startMetronome();
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
                this.playing = false;
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
        // Toggle play/pause on spacebar
        if (event.code === 'Space' && !event.target.matches('input, textarea')) {
            event.preventDefault();
            this._togglePlay();
        }
        // Panic button on Escape - immediately stop all audio
        if (event.code === 'Escape') {
            event.preventDefault();
            this._panic();
        }
    }

    _panic() {
        console.log('[MediaPlayer] PANIC - stopping all audio immediately');

        // Clear any fade intervals
        if (this._fadeInterval) {
            clearInterval(this._fadeInterval);
            this._fadeInterval = null;
        }

        // Immediately stop and mute current audio
        if (this._audio) {
            this._audio.pause();
            this._audio.currentTime = 0;
        }
        if (this._padGain) {
            this._padGain.gain.value = 0;
        }

        // Stop metronome
        this._stopMetronome();

        // Reset all state
        this.playing = false;
        this.metronomeEnabled = false;
        this._fadingIn = false;
        this._fadingOut = false;
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

        console.log(`[MediaPlayer] Starting metronome at ${this.bpm} BPM, ${this.timeSignature}`);

        // Reset beat counter
        this._metronomeBeat = 0;

        // Calculate interval based on BPM
        const beatInterval = 60000 / this.bpm; // milliseconds per beat

        this._metronomeInterval = setInterval(() => {
            this._playClick();
        }, beatInterval);

        // Play first click immediately
        this._playClick();
    }

    _stopMetronome() {
        if (this._metronomeInterval) {
            clearInterval(this._metronomeInterval);
            this._metronomeInterval = null;
        }
        this._metronomeBeat = 0;
    }

    _playClick() {
        if (!this._audioContext) return;

        // Parse time signature
        const [beatsPerBar] = this.timeSignature.split('/').map(Number);

        // Determine if this is the first beat of the bar (accented)
        const isAccent = this._metronomeBeat === 0;

        // Create oscillator for click sound
        const oscillator = this._audioContext.createOscillator();
        const envelope = this._audioContext.createGain();

        oscillator.connect(envelope);
        envelope.connect(this._clickGain);

        // Accented beat is higher pitch and louder
        oscillator.frequency.value = isAccent ? 1000 : 800;
        envelope.gain.value = isAccent ? 2.0 : 1.0;

        const now = this._audioContext.currentTime;
        oscillator.start(now);

        // Quick decay envelope for sharp click
        envelope.gain.setValueAtTime(envelope.gain.value, now);
        envelope.gain.exponentialRampToValueAtTime(0.01, now + 0.03);

        oscillator.stop(now + 0.03);

        // Increment beat counter
        this._metronomeBeat = (this._metronomeBeat + 1) % beatsPerBar;
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

        if (this.playing) {
            await this._fadeOut();
        } else {
            await this._fadeIn();
        }
    }

    async _fadeIn() {
        if (!this._audio) return;

        console.log('[MediaPlayer] Fading in');

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
        this.playing = true;

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
                this.playing = false;
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
                    this.playing = false;
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
        if (this.playing) return 'Playing';
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
            if (this._padGain && this.playing && !this._fadingIn && !this._fadingOut) {
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
        return html`
            <div class="container" part="container">
                ${this._padsEnabled ? html`
                    <div class="control-group">
                        <div class="control-group-label">Pads</div>
                        <div class="control-group-buttons">
                            <button
                                class="play-button ${this.playing ? 'playing' : ''}"
                                part="play-button"
                                @click=${this._togglePlay}
                                aria-label="${this.playing ? 'Pause' : 'Play'}"
                                ?disabled=${!this.currentKey}
                            >
                                ${this.playing ? '⏸' : '▶'}
                            </button>
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
                        <div class="control-group-buttons">
                            <button
                                class="metronome-button ${this.metronomeEnabled ? 'active' : ''}"
                                part="metronome-button"
                                @click=${this._toggleMetronome}
                                aria-label="Toggle metronome"
                                title="Metronome"
                                ?disabled=${!this.bpm || !this.timeSignature}
                            >
                                ♩
                            </button>
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

                <div class="control-group">
                    <div class="control-group-label">Panic</div>
                    <div class="control-group-buttons">
                        <button
                            class="panic-button"
                            part="panic-button"
                            @click=${this._panic}
                            aria-label="Emergency stop (Escape)"
                            title="Emergency stop - Press Escape"
                        >
                            ⏹
                        </button>
                    </div>
                </div>
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
