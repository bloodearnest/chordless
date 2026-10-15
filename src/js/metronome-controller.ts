/**
 * MetronomeController
 *
 * Handles metronome timing, click scheduling, and audio playback.
 * Supports complex time signatures, compound time, and tempo notes.
 */
type ClickType = 'heavy' | 'medium' | 'light'

/*
 * The parts of Web Audio the metronome uses. A real AudioContext and GainNode satisfy these,
 * and so can a test's fakes, which need nothing else.
 */
interface ClickNode {
  connect(destination: unknown): unknown
  disconnect(): unknown
}

export interface ClickOscillator extends ClickNode {
  frequency: { value: number }
  start(when?: number): void
  stop(when?: number): void
}

export interface ClickEnvelope extends ClickNode {
  gain: {
    value: number
    setValueAtTime(value: number, time: number): unknown
    exponentialRampToValueAtTime(value: number, time: number): unknown
  }
}

export interface ClickAudioContext {
  state: string
  currentTime: number
  resume(): Promise<void>
  createOscillator(): ClickOscillator
  createGain(): ClickEnvelope
}

/**
 * A tempo's beat as a fraction of a whole note, as the metronome takes it: 8 and '1/8' and
 * '120 (1/8)' are '1/8'; anything that isn't one is a quarter note
 */
export function normalizeTempoNote(value: string | number | null | undefined): string {
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

/** Where the clicks go: a gain node, whose volume the metronome sets */
export interface ClickOutput {
  gain: { value: number }
}

export class MetronomeController {
  _audioContext: ClickAudioContext | null
  _clickGain: ClickOutput | null
  _isRunning: boolean
  _beatInterval: number | null
  _metronomeInterval: ReturnType<typeof setTimeout> | null
  _metronomeBeat: number
  _activeOscillators: ClickOscillator[]
  _timeSignature: string | null
  _beatsPerBar: number
  /** A click on every half beat as well; _offHalf says the next click is the half between beats */
  _doubleClick: boolean
  _offHalf: boolean
  /** Whether the downbeat sounds different; off, every click is the light one */
  _emphasiseDownbeat: boolean

  /**
   * @param audioContext - Web Audio API context
   * @param clickGain - Gain node for click volume control
   */
  constructor(audioContext: ClickAudioContext, clickGain: ClickOutput) {
    if (!audioContext) {
      throw new Error('AudioContext is required')
    }
    if (!clickGain) {
      throw new Error('clickGain node is required')
    }

    this._audioContext = audioContext
    this._clickGain = clickGain
    this._isRunning = false
    this._beatInterval = null
    this._metronomeInterval = null
    this._metronomeBeat = 0
    this._activeOscillators = []
    this._timeSignature = null
    this._beatsPerBar = 0
    this._doubleClick = false
    this._offHalf = false
    this._emphasiseDownbeat = true
  }

  /**
   * Start the metronome
   * @param bpm - Beats per minute
   * @param timeSignature - Time signature (e.g., "4/4", "6/8")
   * @param tempoNote - Note value for tempo (e.g., "1/4", "1/8")
   * @param options.doubleClick - Click twice per beat: the tempo and the downbeat stay, and
   *   each beat gets another light click halfway
   * @param options.emphasiseDownbeat - Sound the downbeat differently (default); off, every
   *   click is the light one
   * @returns True if started successfully
   */
  start(
    bpm: number | string,
    timeSignature: string,
    tempoNote: string | null = '1/4',
    { doubleClick = false, emphasiseDownbeat = true } = {}
  ): boolean {
    if (!bpm || !timeSignature) {
      console.warn('[MetronomeController] Cannot start: missing BPM or time signature')
      return false
    }

    // Resume AudioContext if suspended
    if (this._audioContext?.state === 'suspended') {
      this._audioContext.resume()
    }

    const normalizedTempoNote = this._normalizeTempoNote(tempoNote)
    const bpmNumber = Number(bpm)

    // Parse time signature
    const [beatsPerBar, noteValue] = timeSignature.split('/').map(Number)

    // Reset beat counter
    this._metronomeBeat = 0
    this._timeSignature = timeSignature
    this._beatsPerBar = beatsPerBar
    this._doubleClick = doubleClick
    this._offHalf = false
    this._emphasiseDownbeat = emphasiseDownbeat

    // Calculate click interval
    const quarterNoteBpm = this._calculateQuarterNoteBpm(
      bpmNumber,
      normalizedTempoNote,
      timeSignature
    )
    const clickNoteValue = this._getClickNoteValue(timeSignature, noteValue)
    const multiplier = (1 / clickNoteValue) * 4
    const quarterNoteInterval = 60000 / quarterNoteBpm
    const beatInterval = (quarterNoteInterval * multiplier) / (doubleClick ? 2 : 1)

    // Store the beat interval
    this._beatInterval = beatInterval
    this._isRunning = true

    // Start the metronome - play first click immediately, then schedule subsequent clicks
    this._playClick()
    this._scheduleNextClick()

    return true
  }

  /**
   * Stop the metronome
   */
  stop(): void {
    if (!this._isRunning && !this._metronomeInterval) {
      return
    }

    // Clear timeout and beat interval
    if (this._metronomeInterval) {
      clearTimeout(this._metronomeInterval)
      this._metronomeInterval = null
    }
    this._beatInterval = null

    // Reset beat counter
    this._metronomeBeat = 0
    this._offHalf = false

    // Stop all active oscillators immediately
    if (this._activeOscillators.length > 0) {
      this._activeOscillators.forEach(oscillator => {
        try {
          oscillator.stop()
          oscillator.disconnect()
        } catch {
          // Oscillator may already be stopped
        }
      })
      this._activeOscillators = []
    }

    this._isRunning = false
  }

  /**
   * Set the click volume
   * @param volume - Volume level (0.0 to 1.0)
   */
  setVolume(volume: number): void {
    if (this._clickGain) {
      this._clickGain.gain.value = volume
    }
  }

  /** Change whether the downbeat is emphasised, while running too */
  setEmphasiseDownbeat(emphasise: boolean): void {
    this._emphasiseDownbeat = emphasise
  }

  /**
   * Check if metronome is currently running
   */
  get isRunning(): boolean {
    return this._isRunning
  }

  /**
   * Get the current click interval in milliseconds (for testing): half a beat when doubled
   */
  get beatInterval(): number | null {
    return this._beatInterval
  }

  /**
   * Normalize tempo note to standard format
   * @private
   */
  _normalizeTempoNote(value: string | null | undefined): string {
    if (!value || value === 'undefined' || value === 'null') {
      return '1/4'
    }
    return value
  }

  /**
   * Calculate quarter note BPM from tempo note BPM
   * @private
   */
  _calculateQuarterNoteBpm(bpm: number, tempoNote: string, timeSignature: string): number {
    let quarterNoteBpm = bpm

    const [beatsPerMeasure, noteValue] = timeSignature.split('/').map(Number)
    const isCompoundTime = noteValue === 8 && beatsPerMeasure % 3 === 0

    if (tempoNote === '1/4' && isCompoundTime) {
      // BPM refers to dotted quarter notes (3 eighths)
      // Convert to quarter note tempo: bpm × 1.5
      quarterNoteBpm = bpm * 1.5
    } else if (tempoNote && tempoNote !== '1/4') {
      const [numerator, denominator] = tempoNote.split('/').map(Number)
      if (numerator && denominator) {
        // Convert to quarter note tempo
        // Formula: quarterNoteBpm = bpm * (numerator * 4 / denominator)
        quarterNoteBpm = bpm * ((numerator * 4) / denominator)
      }
    }

    return quarterNoteBpm
  }

  /**
   * Get the note value to click on based on time signature
   * @private
   */
  _getClickNoteValue(timeSignature: string, noteValue: number): number {
    const [beatsPerMeasure] = timeSignature.split('/').map(Number)
    const isCompoundTime = noteValue === 8 && beatsPerMeasure % 3 === 0

    if (isCompoundTime) {
      return 8 // Always click on eighth notes in compound time
    }
    return noteValue
  }

  /**
   * Schedule the next click
   * @private
   */
  _scheduleNextClick(): void {
    if (!this._beatInterval || !this._isRunning) return

    // (stop() clears the timer, so this runs only while running)
    this._metronomeInterval = setTimeout(() => {
      this._playClick()
      this._scheduleNextClick()
    }, this._beatInterval)
  }

  /**
   * Play a single click sound
   * @private
   */
  _playClick(): void {
    if (!this._audioContext || !this._clickGain || !this._timeSignature) return

    const [beatsPerBar, noteValue] = this._timeSignature.split('/').map(Number)

    // Determine accent level based on beat position and time signature
    let clickType: ClickType = 'light'

    if (this._offHalf || !this._emphasiseDownbeat) {
      // The click between two beats, or every click: all the same
    } else if (this._metronomeBeat === 0) {
      // First beat is always heavy (downbeat)
      clickType = 'heavy'
    } else if (beatsPerBar === 6 && noteValue === 8 && this._metronomeBeat === 3) {
      // 6/8 gets medium accent on beat 4 (two groups of three)
      clickType = 'medium'
    } else if (beatsPerBar === 12 && noteValue === 8) {
      // 12/8 - medium accents every 3 beats (like 4/4)
      if (this._metronomeBeat === 3 || this._metronomeBeat === 6 || this._metronomeBeat === 9) {
        clickType = 'medium'
      }
    }

    // Create oscillator for click sound
    const oscillator = this._audioContext.createOscillator()
    const envelope = this._audioContext.createGain()

    oscillator.connect(envelope)
    envelope.connect(this._clickGain)

    // Set frequency and gain based on accent type
    if (clickType === 'heavy') {
      oscillator.frequency.value = 1000
      envelope.gain.value = 2.0
    } else if (clickType === 'medium') {
      oscillator.frequency.value = 900
      envelope.gain.value = 1.5
    } else {
      // light
      oscillator.frequency.value = 800
      envelope.gain.value = 1.0
    }

    const now = this._audioContext.currentTime
    oscillator.start(now)

    // Quick decay envelope for sharp click
    envelope.gain.setValueAtTime(envelope.gain.value, now)
    envelope.gain.exponentialRampToValueAtTime(0.01, now + 0.03)

    oscillator.stop(now + 0.03)

    // Track this oscillator for cleanup
    this._activeOscillators.push(oscillator)

    // Remove from tracking after it stops
    setTimeout(() => {
      const index = this._activeOscillators.indexOf(oscillator)
      if (index > -1) {
        this._activeOscillators.splice(index, 1)
      }
    }, 50)

    // Increment beat counter (only after the half beat, when doubled)
    if (this._doubleClick) this._offHalf = !this._offHalf
    if (!this._offHalf) this._metronomeBeat = (this._metronomeBeat + 1) % beatsPerBar
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.stop()
    this._audioContext = null
    this._clickGain = null
  }
}
