/**
 * MetronomeController
 *
 * Handles metronome timing, click scheduling, and audio playback.
 * Supports complex time signatures, compound time, and tempo notes.
 */
export class MetronomeController {
    /**
     * @param {AudioContext} audioContext - Web Audio API context
     * @param {GainNode} clickGain - Gain node for click volume control
     */
    constructor(audioContext, clickGain) {
        if (!audioContext) {
            throw new Error('AudioContext is required');
        }
        if (!clickGain) {
            throw new Error('clickGain node is required');
        }

        this._audioContext = audioContext;
        this._clickGain = clickGain;
        this._isRunning = false;
        this._beatInterval = null;
        this._metronomeInterval = null;
        this._metronomeBeat = 0;
        this._activeOscillators = [];
        this._timeSignature = null;
        this._beatsPerBar = 0;
    }

    /**
     * Start the metronome
     * @param {number} bpm - Beats per minute
     * @param {string} timeSignature - Time signature (e.g., "4/4", "6/8")
     * @param {string} tempoNote - Note value for tempo (e.g., "1/4", "1/8")
     * @returns {boolean} True if started successfully
     */
    start(bpm, timeSignature, tempoNote = '1/4') {
        if (!bpm || !timeSignature) {
            console.warn('[MetronomeController] Cannot start: missing BPM or time signature');
            return false;
        }

        // Resume AudioContext if suspended
        if (this._audioContext.state === 'suspended') {
            this._audioContext.resume();
        }

        const normalizedTempoNote = this._normalizeTempoNote(tempoNote);
        const bpmNumber = Number(bpm);

        console.log(`[MetronomeController] Starting at ${bpm} BPM, ${normalizedTempoNote} notes, ${timeSignature}`);

        // Parse time signature
        const [beatsPerBar, noteValue] = timeSignature.split('/').map(Number);
        console.log(`[MetronomeController] Time signature parsed: ${timeSignature} -> beatsPerBar: ${beatsPerBar}`);

        // Reset beat counter
        this._metronomeBeat = 0;
        this._timeSignature = timeSignature;
        this._beatsPerBar = beatsPerBar;

        // Calculate click interval
        const quarterNoteBpm = this._calculateQuarterNoteBpm(bpmNumber, normalizedTempoNote, timeSignature);
        const clickNoteValue = this._getClickNoteValue(timeSignature, noteValue);
        const multiplier = (1 / clickNoteValue) * 4;
        const quarterNoteInterval = 60000 / quarterNoteBpm;
        const beatInterval = quarterNoteInterval * multiplier;

        console.log(`[MetronomeController] BPM: ${bpm} (${normalizedTempoNote}) -> Quarter note BPM: ${quarterNoteBpm.toFixed(1)} -> Clicking on 1/${clickNoteValue} notes -> Click interval: ${beatInterval.toFixed(1)}ms (multiplier: ${multiplier})`);

        // Store the beat interval
        this._beatInterval = beatInterval;
        this._isRunning = true;

        // Start the metronome - play first click immediately, then schedule subsequent clicks
        this._playClick();
        this._scheduleNextClick();

        return true;
    }

    /**
     * Stop the metronome
     */
    stop() {
        if (!this._isRunning && !this._metronomeInterval) {
            return;
        }

        console.log('[MetronomeController] Stopping, active oscillators:', this._activeOscillators.length);

        // Clear timeout and beat interval
        if (this._metronomeInterval) {
            clearTimeout(this._metronomeInterval);
            this._metronomeInterval = null;
        }
        this._beatInterval = null;

        // Reset beat counter
        this._metronomeBeat = 0;

        // Stop all active oscillators immediately
        if (this._activeOscillators.length > 0) {
            this._activeOscillators.forEach(oscillator => {
                try {
                    oscillator.stop();
                    oscillator.disconnect();
                } catch (e) {
                    // Oscillator may already be stopped
                }
            });
            this._activeOscillators = [];
        }

        this._isRunning = false;
        console.log('[MetronomeController] Stopped');
    }

    /**
     * Set the click volume
     * @param {number} volume - Volume level (0.0 to 1.0)
     */
    setVolume(volume) {
        if (this._clickGain) {
            this._clickGain.gain.value = volume;
        }
    }

    /**
     * Check if metronome is currently running
     * @returns {boolean}
     */
    get isRunning() {
        return this._isRunning;
    }

    /**
     * Get the current beat interval in milliseconds (for testing)
     * @returns {number|null}
     */
    get beatInterval() {
        return this._beatInterval;
    }

    /**
     * Normalize tempo note to standard format
     * @private
     */
    _normalizeTempoNote(value) {
        if (!value || value === 'undefined' || value === 'null') {
            return '1/4';
        }
        return value;
    }

    /**
     * Calculate quarter note BPM from tempo note BPM
     * @private
     */
    _calculateQuarterNoteBpm(bpm, tempoNote, timeSignature) {
        let quarterNoteBpm = bpm;

        const [beatsPerMeasure, noteValue] = timeSignature.split('/').map(Number);
        const isCompoundTime = noteValue === 8 && beatsPerMeasure % 3 === 0;

        if (tempoNote === '1/4' && isCompoundTime) {
            // BPM refers to dotted quarter notes (3 eighths)
            // Convert to quarter note tempo: bpm × 1.5
            quarterNoteBpm = bpm * 1.5;
            console.log(`[MetronomeController] Applied compound time conversion: ${bpm} -> ${quarterNoteBpm}`);
        } else if (tempoNote && tempoNote !== '1/4') {
            const [numerator, denominator] = tempoNote.split('/').map(Number);
            if (numerator && denominator) {
                // Convert to quarter note tempo
                // Formula: quarterNoteBpm = bpm * (numerator * 4 / denominator)
                quarterNoteBpm = bpm * (numerator * 4 / denominator);
            }
        }

        return quarterNoteBpm;
    }

    /**
     * Get the note value to click on based on time signature
     * @private
     */
    _getClickNoteValue(timeSignature, noteValue) {
        const [beatsPerMeasure] = timeSignature.split('/').map(Number);
        const isCompoundTime = noteValue === 8 && beatsPerMeasure % 3 === 0;

        if (isCompoundTime) {
            return 8; // Always click on eighth notes in compound time
        }
        return noteValue;
    }

    /**
     * Schedule the next click
     * @private
     */
    _scheduleNextClick() {
        if (!this._beatInterval || !this._isRunning) return;

        this._metronomeInterval = setTimeout(() => {
            if (!this._isRunning) {
                return;
            }
            this._playClick();
            this._scheduleNextClick();
        }, this._beatInterval);
    }

    /**
     * Play a single click sound
     * @private
     */
    _playClick() {
        if (!this._audioContext || !this._timeSignature) return;

        const [beatsPerBar, noteValue] = this._timeSignature.split('/').map(Number);

        // Determine accent level based on beat position and time signature
        let clickType = 'light';

        if (this._metronomeBeat === 0) {
            // First beat is always heavy (downbeat)
            clickType = 'heavy';
        } else if (beatsPerBar === 6 && noteValue === 8 && this._metronomeBeat === 3) {
            // 6/8 gets medium accent on beat 4 (two groups of three)
            clickType = 'medium';
        } else if (beatsPerBar === 12 && noteValue === 8) {
            // 12/8 - medium accents every 3 beats (like 4/4)
            if (this._metronomeBeat === 3 || this._metronomeBeat === 6 || this._metronomeBeat === 9) {
                clickType = 'medium';
            }
        }

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

    /**
     * Clean up resources
     */
    cleanup() {
        this.stop();
        this._audioContext = null;
        this._clickGain = null;
    }
}
