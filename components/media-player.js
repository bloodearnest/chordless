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
        playing: { type: Boolean, reflect: true },
        _fadingOut: { type: Boolean, state: true },
        _fadingIn: { type: Boolean, state: true }
    };

    static styles = css`
        :host {
            display: block;
        }

        .container {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1rem;
            background: var(--player-bg, #34495e);
            border-radius: 8px;
            color: var(--player-text, white);
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
            font-size: 1.5rem;
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

        .info {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
        }

        .key-display {
            font-size: 1.2rem;
            font-weight: 600;
        }

        .status {
            font-size: 0.9rem;
            opacity: 0.8;
        }

        .status.fading {
            font-style: italic;
        }

        .panic-button {
            width: 2.5rem;
            height: 2.5rem;
            border-radius: 50%;
            border: 2px solid #e74c3c;
            background: transparent;
            color: #e74c3c;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.2rem;
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
    `;

    constructor() {
        super();
        this.currentKey = '';
        this.playing = false;
        this._fadingOut = false;
        this._fadingIn = false;
        this._audio = null;
        this._fadeInterval = null;
        this._targetVolume = 0.7; // Default volume when fully faded in
        this._fadeDuration = 5000; // 5 seconds
    }

    connectedCallback() {
        super.connectedCallback();
        this._initAudio();
        this._boundHandleKeydown = this._handleKeydown.bind(this);
        document.addEventListener('keydown', this._boundHandleKeydown);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._cleanup();
        document.removeEventListener('keydown', this._boundHandleKeydown);
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
    }

    _initAudio() {
        if (!this._audio) {
            this._audio = new Audio();
            this._audio.loop = true;
            this._audio.volume = 0; // Start silent

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
            this._audio.volume = 0;
            this._audio.currentTime = 0;
        }

        // Reset all state
        this.playing = false;
        this._fadingIn = false;
        this._fadingOut = false;
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

        // Clear any existing fade interval
        if (this._fadeInterval) {
            clearInterval(this._fadeInterval);
            this._fadeInterval = null;
        }

        this._fadingIn = true;
        this.playing = true;

        // Check if audio is already playing (e.g., interrupted from fade-out)
        const alreadyPlaying = !this._audio.paused;
        const startVolume = this._audio.volume;

        if (!alreadyPlaying) {
            // Start playing at volume 0
            this._audio.volume = 0;
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
        const currentVolume = this._audio.volume;
        const volumeRange = this._targetVolume - currentVolume;
        const steps = 60; // 60 steps for smooth fade
        const stepDuration = this._fadeDuration / steps;

        let currentStep = 0;
        this._fadeInterval = setInterval(() => {
            currentStep++;
            // Use exponential curve: progress^2 for smooth fade-in
            const progress = currentStep / steps;
            const newVolume = Math.min(currentVolume + (volumeRange * (progress * progress)), this._targetVolume);
            this._audio.volume = newVolume;

            if (currentStep >= steps || newVolume >= this._targetVolume) {
                clearInterval(this._fadeInterval);
                this._fadeInterval = null;
                this._audio.volume = this._targetVolume; // Ensure we hit target
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
        const startVolume = this._audio.volume;

        let currentStep = 0;
        return new Promise((resolve) => {
            this._fadeInterval = setInterval(() => {
                currentStep++;
                // Use inverse exponential curve: (1-progress)^2 for smooth fade-out
                const progress = currentStep / steps;
                const remaining = 1 - progress;
                const newVolume = Math.max(startVolume * (remaining * remaining), 0);
                this._audio.volume = newVolume;

                // Complete when we've done all steps or volume is effectively zero
                if (currentStep >= steps || newVolume < 0.01) {
                    clearInterval(this._fadeInterval);
                    this._fadeInterval = null;
                    this._audio.volume = 0; // Ensure it's actually zero
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
        newAudio.volume = 0;
        const newUrl = `/pads/${encodeURIComponent(this.currentKey)} - WARM - CHURCHFRONT PADS.mp3`;
        newAudio.src = newUrl;

        // Keep reference to old audio
        const oldAudio = this._audio;

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

        // Switch to the new audio element
        this._audio = newAudio;

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
        const oldStartVolume = oldAudio.volume;

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
                oldAudio.volume = oldVolume;
            } else {
                // Old audio finished fading, stop it
                if (oldAudio.volume > 0) {
                    oldAudio.volume = 0;
                    oldAudio.pause();
                }
            }

            // Fade in new audio starting at 4 seconds (1s overlap with old)
            if (currentStep >= fadeInStartStep) {
                const fadeInProgress = (currentStep - fadeInStartStep) / (steps - fadeInStartStep);
                const newVolume = Math.min(this._targetVolume * (fadeInProgress * fadeInProgress), this._targetVolume);
                newAudio.volume = newVolume;
            }

            if (currentStep >= steps) {
                clearInterval(this._fadeInterval);
                this._fadeInterval = null;

                // Cleanup old audio
                oldAudio.pause();
                oldAudio.volume = 0;

                // Ensure new audio is at target volume
                newAudio.volume = this._targetVolume;

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

    render() {
        return html`
            <div class="container" part="container">
                <button
                    class="play-button ${this.playing ? 'playing' : ''}"
                    part="play-button"
                    @click=${this._togglePlay}
                    aria-label="${this.playing ? 'Pause' : 'Play'}"
                    ?disabled=${!this.currentKey}
                >
                    ${this.playing ? '⏸' : '▶'}
                </button>
                <div class="info">
                    <div class="key-display">
                        ${this.currentKey ? `Key: ${this.currentKey}` : 'No key set'}
                    </div>
                    <div class="status ${this._fadingIn || this._fadingOut ? 'fading' : ''}">
                        ${this._getStatusText()}
                    </div>
                </div>
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
        `;
    }
}

// Define the custom element
customElements.define('media-player', MediaPlayer);
