import { css, html, LitElement } from 'lit'
import { appUpdate } from '../js/app-update.ts'
import { emailBody, emailLink, type SupportInfo } from '../js/contact.ts'
import { getTelemetryPreference } from '../js/preferences.ts'
import { rich } from '../js/rich-text.ts'
import { deviceFacts, type LowPower, speedTestReport } from '../js/speed-test/report.ts'
import {
  type Progress,
  runSpeedTest,
  SCROLL_MS,
  SIZES,
  type SpeedTestOutcome,
} from '../js/speed-test/runner.ts'
import {
  recordSpeedTest,
  recordSpeedTestFailure,
  type SpeedTestRun,
} from '../js/speed-test/telemetry.ts'
import type { VariantId } from '../js/speed-test/variants.ts'
import { deviceDetails } from '../js/telemetry/device.ts'
import { supportId } from '../js/telemetry/ids.ts'
import { t } from '../js/text.ts'
import { buttonStyles, fieldStyles, panelStyles } from './shared-styles.ts'

const SUBJECT = 'Chordless speed test'

type State = 'idle' | 'running' | 'done' | 'failed'

/** What is being timed, in words */
function what(variant: VariantId, songs: number): string {
  switch (variant) {
    case 'real':
      return t('speed-test-what-real', { count: songs })
    case 'lyrics':
      return t('speed-test-what-lyrics', { count: songs })
    case 'plain':
      return t('speed-test-what-plain', { count: songs })
  }
}

/**
 * AppSpeedTest (docs/SPEED_TEST.md)
 *
 * Times how long made-up songs take to draw on this device, three ways, and says what it found: as
 * anonymous usage reports to Honeycomb, with the app's other reports and by the same switch
 * (js/speed-test/telemetry.ts), and as a report to copy or send. It aims to tell us where the time
 * goes on a device that feels slow, which only the device can say.
 */
export class AppSpeedTest extends LitElement {
  static override properties = {
    _state: { state: true },
    _progress: { state: true },
    _report: { state: true },
    _note: { state: true },
    _lowPower: { state: true },
    _sent: { state: true },
    _version: { state: true },
    _copied: { state: true },
    _failure: { state: true },
    /** The setlist sizes to time, and how long to scroll each (the usual ones; tests make them small) */
    sizes: { attribute: false },
    scrollMs: { attribute: false },
  }

  declare _state: State
  declare _progress: Progress | null
  declare _report: string
  declare _note: string
  declare _lowPower: LowPower
  declare _sent: boolean
  declare _version: string
  declare _copied: boolean
  declare _failure: string
  declare sizes: number[]
  declare scrollMs: number

  /** How long "Copied" stays on the button */
  static copiedMs = 2000

  #abort: AbortController | null = null

  static override styles = [
    panelStyles,
    buttonStyles,
    fieldStyles,
    css`
      :host {
        display: block;
      }

      .speed-test-content {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      label {
        display: block;
        font-size: var(--font-ui-small);
        margin-bottom: 0.5rem;
      }

      textarea.field {
        min-height: 4em;
        resize: vertical;
        margin-bottom: 1rem;
      }

      pre {
        margin: 0 0 1rem;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-size: var(--font-ui-small);
        font-family: inherit;
        opacity: 0.85;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      a.btn {
        text-decoration: none;
        display: inline-block;
      }

      .progress {
        font-size: var(--font-ui);
        margin: 0 0 1rem;
      }

      /* What is timed is drawn here, on the screen: a page that is not painted is not timed */
      .stage {
        height: 60vh;
        overflow-y: auto;
        padding: 0.5rem 1rem;
        border: 1px solid var(--panel-border, transparent);
        border-radius: 8px;
      }

      .stage[hidden] {
        display: none;
      }

      /* The plain way of drawing a song: the song section's own rules for a line, with no component */
      .plain-section {
        margin: 0.5rem 0;
      }

      .plain-song {
        margin-bottom: 1rem;
      }

      .chord-unit {
        display: inline-flex;
      }

      .chord-segment {
        display: inline-flex;
        flex-direction: column;
        white-space: pre-wrap;
      }

      .chord {
        color: var(--chord-tint-ink, var(--chord-color, #1d6a9c));
        font-weight: bold;
        font-size: var(--font-chords);
        line-height: 1.1em;
        padding-right: 0.25em;
        font-family: var(--font-family-chords, 'Source Sans Pro', 'Segoe UI', sans-serif);
        display: inline-block;
        white-space: nowrap;
      }

      .chord-empty {
        visibility: hidden;
      }

      .lyrics {
        font-family: var(--font-family-lyrics, inherit);
        font-size: var(--font-lyrics);
        line-height: 1.4em;
        overflow-wrap: break-word;
      }
    `,
  ]

  constructor() {
    super()
    this._state = 'idle'
    this._progress = null
    this._report = ''
    this._note = ''
    this._lowPower = 'unknown'
    this._sent = false
    this._version = ''
    this._copied = false
    this._failure = ''
    this.sizes = SIZES
    this.scrollMs = SCROLL_MS
  }

  override connectedCallback() {
    super.connectedCallback()
    void appUpdate
      .runningVersion()
      .then(running => {
        this._version = running?.version ?? ''
      })
      .catch(() => {
        // (no version to give: the report says it is unknown)
      })
  }

  /** Leaving the page ends the test: what it draws is nothing to leave running */
  override disconnectedCallback() {
    super.disconnectedCallback()
    this.#abort?.abort()
  }

  _info(): SupportInfo {
    return {
      supportId: supportId(),
      version: this._version,
      device: deviceDetails(),
      online: navigator.onLine,
      userAgent: navigator.userAgent,
    }
  }

  async _start(): Promise<void> {
    if (this._state === 'running') return
    this.#abort = new AbortController()
    this._state = 'running'
    this._failure = ''
    this._sent = false
    this._progress = null
    const facts = deviceFacts()
    const run: SpeedTestRun = { id: crypto.randomUUID(), lowPower: this._lowPower, facts }
    // (the stage is shown once this has rendered, and it has to be seen to be timed)
    await this.updateComplete
    const stage = this.renderRoot.querySelector<HTMLElement>('.stage')
    /* v8 ignore next -- the stage is in every render */
    if (!stage) return
    stage.scrollIntoView({ block: 'start' })
    const when = new Date()
    let outcome: SpeedTestOutcome
    try {
      outcome = await runSpeedTest(stage, {
        signal: this.#abort.signal,
        sizes: this.sizes,
        scrollMs: this.scrollMs,
        onProgress: progress => {
          this._progress = progress
        },
      })
    } catch (error) {
      this._failure = error instanceof Error ? error.message : String(error)
      recordSpeedTestFailure(error, run)
      this._state = 'failed'
      return
    }
    this._report = speedTestReport({
      info: this._info(),
      facts,
      lowPower: this._lowPower,
      outcome,
      note: this._note,
      when,
    })
    this._sent = recordSpeedTest(outcome, run)
    this._state = 'done'
  }

  _stop(): void {
    this.#abort?.abort()
  }

  async _copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this._report)
      this._copied = true
      setTimeout(() => {
        this._copied = false
      }, AppSpeedTest.copiedMs)
    } catch {
      // (the report is on screen to select)
    }
  }

  _onNote(event: Event): void {
    this._note = (event.target as HTMLTextAreaElement).value
  }

  _onLowPower(event: Event): void {
    this._lowPower = (event.target as HTMLSelectElement).value as LowPower
  }

  _renderIntro() {
    return html`
      <div class="panel">
        <h3>${t('speed-test-heading')}</h3>
        <p>${t('speed-test-intro')}</p>
        <p id="speed-test-private">
          ${rich(
            getTelemetryPreference() ? 'speed-test-private-on' : 'speed-test-private-off',
            undefined,
            {
              privacy: words => html`<a href="/privacy.html" rel="external">${words}</a>`,
            }
          )}
        </p>
        <label for="speed-test-low-power">${t('speed-test-low-power-label')}</label>
        <select id="speed-test-low-power" class="field" @change=${this._onLowPower}>
          <option value="unknown" ?selected=${this._lowPower === 'unknown'}>
            ${t('speed-test-low-power-unknown')}
          </option>
          <option value="on" ?selected=${this._lowPower === 'on'}>${t('speed-test-low-power-on')}</option>
          <option value="off" ?selected=${this._lowPower === 'off'}>${t('speed-test-low-power-off')}</option>
        </select>
        <label for="speed-test-note">${t('speed-test-note-label')}</label>
        <textarea
          id="speed-test-note"
          class="field"
          .value=${this._note}
          @input=${this._onNote}
        ></textarea>
        ${this._state === 'failed' ? html`<p id="speed-test-failed">${t('speed-test-failed', { reason: this._failure })}</p>` : ''}
        <div class="actions">
          <button type="button" id="speed-test-start" class="btn primary" @click=${this._start}>
            ${this._state === 'done' ? t('speed-test-again') : t('speed-test-start')}
          </button>
        </div>
      </div>
    `
  }

  _renderProgress() {
    const progress = this._progress
    return html`
      <div class="panel">
        <p class="progress" id="speed-test-progress" role="status" aria-live="polite">
          ${
            progress
              ? t('speed-test-progress', {
                  done: progress.done + 1,
                  total: progress.total,
                  what: what(progress.variant, progress.songs),
                })
              : t('speed-test-starting')
          }
        </p>
        <div class="actions">
          <button type="button" id="speed-test-stop" class="btn" @click=${this._stop}>
            ${t('speed-test-stop')}
          </button>
        </div>
      </div>
    `
  }

  _renderReport() {
    const link = emailLink(
      SUBJECT,
      emailBody('', this._report),
      typeof navigator.share === 'function'
    )
    return html`
      <div class="panel">
        <h3>${t('speed-test-done-heading')}</h3>
        <p id="speed-test-sent">
          ${this._sent ? t('speed-test-sent') : t('speed-test-not-sent')}
        </p>
        <p>${t('speed-test-done-text')}</p>
        <pre id="speed-test-report">${this._report}</pre>
        <div class="actions">
          <a id="speed-test-send" class="btn primary" href=${link} target="_blank" rel="noopener">
            ${t('speed-test-write')}
          </a>
          <button type="button" id="speed-test-copy" class="btn" @click=${this._copy}>
            ${this._copied ? t('storage-copied') : t('speed-test-copy')}
          </button>
        </div>
      </div>
    `
  }

  override render() {
    const running = this._state === 'running'
    return html`
      <div class="speed-test-content">
        ${running ? this._renderProgress() : this._renderIntro()}
        <div class="stage" ?hidden=${!running}></div>
        ${this._state === 'done' ? this._renderReport() : ''}
      </div>
    `
  }
}
customElements.define('app-speed-test', AppSpeedTest)

declare global {
  interface HTMLElementTagNameMap {
    'app-speed-test': AppSpeedTest
  }
}
