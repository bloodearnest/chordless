import { normalizePadKey } from './pad-keys.js';
import { getPadCacheUrl, ensurePadKeyCached, isPadKeyCached } from './pad-set-service.js';

/**
 * PadAudioController
 *
 * Handles pad audio loading, playback, fading, crossfading, and stereo routing.
 */
export class PadAudioController {
    /**
     * @param {AudioContext} audioContext - Web Audio API context
     * @param {Object} options - Configuration options
     * @param {number} options.fadeDuration - Fade duration in milliseconds (default: 3000)
     */
    constructor(audioContext, options = {}) {
        if (!audioContext) {
            throw new Error('AudioContext is required');
        }

        this._audioContext = audioContext;
        this._fadeDuration = options.fadeDuration || 3000;
        this._volume = 0.7; // Default volume
        this._stereoMode = 'both'; // 'both', 'left', or 'right'

        // Audio elements and nodes
        this._audio = null;
        this._padSource = null;
        this._padGain = null;
        this._padSplitter = null;
        this._padMerger = null;

        // State
        this._isPlaying = false;
        this._loadFailed = false;
        this._fadingIn = false;
        this._fadingOut = false;
        this._fadeInterval = null;
        this._currentKey = null;
        this._activePadSet = null;
        this._padLoadingCount = 0;
        this._isPadLoading = false;

        // Bind error handler
        this._boundErrorHandler = this._handleAudioError.bind(this);
    }

    /**
     * Initialize audio element and Web Audio nodes
     * @private
     */
    _initAudio() {
        if (this._audio) return;

        // Create audio element
        this._audio = new Audio();
        this._audio.loop = true;
        this._audio.crossOrigin = 'anonymous';
        this._audio.addEventListener('error', this._boundErrorHandler);

        // Create Web Audio nodes
        this._padSource = this._audioContext.createMediaElementSource(this._audio);
        this._padGain = this._audioContext.createGain();
        this._padGain.gain.value = 0; // Start silent

        // Initial routing
        this._padSource.connect(this._padGain);
        this._updateAudioRouting();
    }

    /**
     * Load pad audio for a specific key
     * @param {string} key - Musical key (e.g., "C", "D", "E")
     * @param {Object} padSet - Optional pad set configuration
     * @returns {Promise<boolean>} True if loaded successfully
     */
    async loadPad(key, padSet = null) {
        if (!key) {
            console.warn('[PadAudioController] Cannot load pad: no key provided');
            return false;
        }

        this._initAudio();
        this._currentKey = key;
        this._activePadSet = padSet;

        const url = await this._resolvePadUrl(key, padSet);
        if (!url) {
            console.warn(`[PadAudioController] No pad audio available for key "${key}"`);
            this._audio.removeAttribute('src');
            this._loadFailed = true;
            return false;
        }

        console.log('[PadAudioController] Loading pad:', url);
        this._audio.src = url;
        this._loadFailed = false;
        return true;
    }

    /**
     * Start playing with fade in
     * @param {number} duration - Optional fade duration override (ms)
     * @returns {Promise<void>}
     */
    async play(duration = null) {
        if (!this._audio || !this._audio.src) {
            console.error('[PadAudioController] Cannot play: no audio loaded');
            return;
        }

        await this._fadeIn(duration);
    }

    /**
     * Stop playing with fade out
     * @param {number} duration - Optional fade duration override (ms)
     * @returns {Promise<void>}
     */
    async stop(duration = null) {
        if (!this._audio) {
            return;
        }

        await this._fadeOut(duration);
    }

    /**
     * Crossfade to a new key
     * @param {string} newKey - New musical key
     * @param {Object} padSet - Optional pad set configuration
     * @returns {Promise<void>}
     */
    async crossfadeTo(newKey, padSet = null) {
        console.log('[PadAudioController] Crossfading to', newKey);

        const oldAudio = this._audio;
        const oldPadGain = this._padGain;

        // Resolve new pad URL
        const padUrl = await this._resolvePadUrl(newKey, padSet);
        if (!padUrl) {
            console.warn('[PadAudioController] Unable to crossfade: no pad audio for new key');
            await this._fadeOutPadGain(oldPadGain, oldAudio);
            this._loadFailed = true;
            return;
        }

        // Create new audio element
        this._audio = new Audio();
        this._audio.loop = true;
        this._audio.crossOrigin = 'anonymous';
        this._audio.addEventListener('error', this._boundErrorHandler);

        // Create new Web Audio nodes
        const newPadSource = this._audioContext.createMediaElementSource(this._audio);
        this._padGain = this._audioContext.createGain();
        this._padGain.gain.value = 0; // Start silent

        // Connect new audio
        newPadSource.connect(this._padGain);
        this._updateAudioRouting();

        // Update source
        this._audio.src = padUrl;
        this._currentKey = newKey;
        this._activePadSet = padSet;
        this._loadFailed = false;

        // Start playing the new audio
        try {
            await this._audio.play();
            this._isPlaying = true;
        } catch (e) {
            console.error('[PadAudioController] Failed to start new audio:', e);
            this._loadFailed = true;
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
                oldPadGain.gain.value = this._volume * (1 - progress);
            }

            // Fade in new
            this._padGain.gain.value = this._volume * progress;

            if (step >= fadeSteps) {
                clearInterval(crossfadeInterval);

                // Clean up old audio
                if (oldAudio) {
                    oldAudio.pause();
                    oldAudio.currentTime = 0;
                    oldAudio.removeEventListener('error', this._boundErrorHandler);
                }

                console.log('[PadAudioController] Crossfade complete');
            }
        }, fadeInterval);
    }

    /**
     * Set the volume level
     * @param {number} volume - Volume (0.0 to 1.0)
     */
    setVolume(volume) {
        this._volume = volume;
        if (this._padGain && this._isPlaying && !this._fadingIn && !this._fadingOut) {
            this._padGain.gain.value = volume;
        }
    }

    /**
     * Set the stereo routing mode
     * @param {string} mode - 'both', 'left', or 'right'
     */
    setStereoMode(mode) {
        if (!['both', 'left', 'right'].includes(mode)) {
            console.warn('[PadAudioController] Invalid stereo mode:', mode);
            return;
        }

        this._stereoMode = mode;
        this._updateAudioRouting();
    }

    /**
     * Get current playback state
     * @returns {boolean}
     */
    get isPlaying() {
        return this._isPlaying && this._audio && !this._audio.paused;
    }

    /**
     * Get load failure state
     * @returns {boolean}
     */
    get loadFailed() {
        return this._loadFailed;
    }

    /**
     * Get current key
     * @returns {string|null}
     */
    get currentKey() {
        return this._currentKey;
    }

    /**
     * Get loading state
     * @returns {boolean}
     */
    get isLoading() {
        return this._isPadLoading;
    }

    /**
     * Update audio routing based on stereo mode
     * @private
     */
    _updateAudioRouting() {
        if (!this._audioContext || !this._padGain) return;

        // Disconnect existing routing
        this._padGain.disconnect();

        if (this._padSplitter) {
            this._padSplitter.disconnect();
            this._padSplitter = null;
        }
        if (this._padMerger) {
            this._padMerger.disconnect();
            this._padMerger = null;
        }

        if (this._stereoMode === 'left') {
            // Route pads to left channel only
            this._padSplitter = this._audioContext.createChannelSplitter(2);
            this._padMerger = this._audioContext.createChannelMerger(2);

            this._padGain.connect(this._padSplitter);
            this._padSplitter.connect(this._padMerger, 0, 0); // Left input to left output
            this._padMerger.connect(this._audioContext.destination);
        } else if (this._stereoMode === 'right') {
            // Route pads to right channel only
            this._padSplitter = this._audioContext.createChannelSplitter(2);
            this._padMerger = this._audioContext.createChannelMerger(2);

            this._padGain.connect(this._padSplitter);
            this._padSplitter.connect(this._padMerger, 0, 1); // Left input to right output
            this._padMerger.connect(this._audioContext.destination);
        } else {
            // Normal stereo routing (both channels)
            this._padGain.connect(this._audioContext.destination);
        }
    }

    /**
     * Resolve pad URL for a given key
     * @private
     */
    async _resolvePadUrl(key, padSet) {
        if (!key) return null;

        const padKey = normalizePadKey(key);
        if (!padKey) return null;

        if (padSet && padSet.type === 'drive') {
            const alreadyCached = await isPadKeyCached(padSet, padKey);
            if (!alreadyCached) {
                this._padLoadingCount++;
                this._isPadLoading = true;
                try {
                    await ensurePadKeyCached(padSet, padKey);
                } catch (error) {
                    console.error('[PadAudioController] Failed to cache pad audio from Drive:', error);
                    return null;
                } finally {
                    this._padLoadingCount = Math.max(0, this._padLoadingCount - 1);
                    if (this._padLoadingCount === 0) {
                        this._isPadLoading = false;
                    }
                }
            }
            return getPadCacheUrl(padSet.id, padKey);
        }

        return `/pads/${encodeURIComponent(padKey)} - WARM - CHURCHFRONT PADS.mp3`;
    }

    /**
     * Handle audio loading errors
     * @private
     */
    _handleAudioError(event) {
        const source = event?.target?.currentSrc || event?.target?.src || this._audio?.currentSrc || this._audio?.src;
        console.warn('[PadAudioController] Pad audio error:', source || this._currentKey || 'unknown source', event?.error || event);
        this._loadFailed = true;
        this._fadingIn = false;
        this._fadingOut = false;

        if (this._padGain) {
            this._padGain.gain.value = 0;
        }

        if (event?.target && !event.target.paused) {
            try {
                event.target.pause();
            } catch (err) {
                console.debug('[PadAudioController] Unable to pause errored audio:', err);
            }
        }
    }

    /**
     * Fade in audio
     * @private
     */
    async _fadeIn(duration = null) {
        if (!this._audio) {
            console.error('[PadAudioController] Cannot fade in: no audio loaded');
            return;
        }

        const fadeDuration = duration || this._fadeDuration;
        console.log('[PadAudioController] Fading in, audio src:', this._audio.src);

        // Resume AudioContext if suspended
        if (this._audioContext.state === 'suspended') {
            console.log('[PadAudioController] Resuming AudioContext');
            await this._audioContext.resume();
        }

        // Clear any existing fade interval
        if (this._fadeInterval) {
            clearInterval(this._fadeInterval);
            this._fadeInterval = null;
        }

        this._fadingIn = true;
        this._isPlaying = true;

        // Check if audio is already playing
        const alreadyPlaying = !this._audio.paused;
        const startVolume = this._padGain.gain.value;

        if (!alreadyPlaying) {
            // Start playing at volume 0
            this._padGain.gain.value = 0;
            try {
                await this._audio.play();
            } catch (error) {
                console.error('[PadAudioController] Play failed:', error);
                this._fadingIn = false;
                this._loadFailed = true;
                return;
            }

            // Wait for audio to actually start playing
            await new Promise((resolve) => {
                const handlePlaying = () => {
                    this._audio.removeEventListener('playing', handlePlaying);
                    resolve();
                };

                if (!this._audio.paused && this._audio.currentTime > 0) {
                    resolve();
                } else {
                    this._audio.addEventListener('playing', handlePlaying);
                    setTimeout(resolve, 200); // Fallback timeout
                }
            });
        } else {
            console.log('[PadAudioController] Audio already playing at volume', startVolume);
        }

        // Fade in with exponential curve
        const currentVolume = this._padGain.gain.value;
        const volumeRange = this._volume - currentVolume;
        const steps = 60;
        const stepDuration = fadeDuration / steps;

        let currentStep = 0;
        this._fadeInterval = setInterval(() => {
            currentStep++;
            const progress = currentStep / steps;
            const newVolume = Math.min(currentVolume + (volumeRange * (progress * progress)), this._volume);
            this._padGain.gain.value = newVolume;

            if (currentStep >= steps || newVolume >= this._volume) {
                clearInterval(this._fadeInterval);
                this._fadeInterval = null;
                this._padGain.gain.value = this._volume;
                this._fadingIn = false;
                console.log('[PadAudioController] Fade in complete');
            }
        }, stepDuration);
    }

    /**
     * Fade out audio
     * @private
     */
    async _fadeOut(duration = null) {
        if (!this._audio) return;

        const fadeDuration = duration || this._fadeDuration;
        console.log('[PadAudioController] Fading out');
        this._fadingOut = true;

        // Clear any existing fade interval
        if (this._fadeInterval) {
            clearInterval(this._fadeInterval);
            this._fadeInterval = null;
        }

        const steps = 60;
        const stepDuration = fadeDuration / steps;
        const startVolume = this._padGain.gain.value;

        let currentStep = 0;
        return new Promise((resolve) => {
            this._fadeInterval = setInterval(() => {
                currentStep++;
                const progress = currentStep / steps;
                const remaining = 1 - progress;
                const newVolume = Math.max(startVolume * (remaining * remaining), 0);
                this._padGain.gain.value = newVolume;

                if (currentStep >= steps || newVolume < 0.01) {
                    clearInterval(this._fadeInterval);
                    this._fadeInterval = null;
                    this._padGain.gain.value = 0;
                    this._audio.pause();
                    this._fadingOut = false;
                    this._isPlaying = false;
                    console.log('[PadAudioController] Fade out complete');
                    resolve();
                }
            }, stepDuration);
        });
    }

    /**
     * Fade out a specific gain node (used for crossfading)
     * @private
     */
    async _fadeOutPadGain(padGain, audioElement) {
        if (!padGain || !audioElement) {
            return Promise.resolve();
        }

        const steps = 60;
        const stepDuration = this._fadeDuration / steps;
        const startVolume = padGain.gain.value;

        let currentStep = 0;
        return new Promise((resolve) => {
            const fadeInterval = setInterval(() => {
                currentStep++;
                const progress = currentStep / steps;
                const remaining = 1 - progress;
                const newVolume = Math.max(startVolume * (remaining * remaining), 0);
                padGain.gain.value = newVolume;

                if (currentStep >= steps || newVolume < 0.01) {
                    clearInterval(fadeInterval);
                    padGain.gain.value = 0;
                    audioElement.pause();
                    audioElement.currentTime = 0;
                    audioElement.removeEventListener('error', this._boundErrorHandler);
                    resolve();
                }
            }, stepDuration);
        });
    }

    /**
     * Clean up resources
     */
    cleanup() {
        if (this._fadeInterval) {
            clearInterval(this._fadeInterval);
            this._fadeInterval = null;
        }

        if (this._audio) {
            this._audio.pause();
            this._audio.removeEventListener('error', this._boundErrorHandler);
            this._audio = null;
        }

        if (this._padSplitter) {
            this._padSplitter.disconnect();
            this._padSplitter = null;
        }

        if (this._padMerger) {
            this._padMerger.disconnect();
            this._padMerger = null;
        }

        if (this._padGain) {
            this._padGain.disconnect();
            this._padGain = null;
        }

        this._padSource = null;
        this._audioContext = null;
    }
}
