import { css, html, LitElement } from 'lit'
import {
  getTelemetryPreference,
  setTelemetryPreference,
  TelemetryPreferenceEvent,
} from '../js/preferences.ts'
import { rich } from '../js/rich-text.ts'
import { resetDeviceId, supportId } from '../js/telemetry/ids.ts'
import { t } from '../js/text.ts'

/**
 * The switch for the anonymous usage reports (docs/OBSERVABILITY.md), and the support id that finds a
 * device's reports. It sits on the privacy page, beside what the reports hold, not in Preferences.
 */
export class UsageReportsSetting extends LitElement {
  static override properties = {
    telemetry: { type: Boolean, attribute: false },
    supportId: { type: String, attribute: false },
  }

  declare telemetry: boolean
  /** The start of this device's id for the usage reports, to read out to whoever is helping; '' when they are off */
  declare supportId: string

  static override styles = [
    css`
      :host {
        display: block;
        margin: 1rem 0;
      }

      .toggle {
        display: inline-flex;
        align-items: center;
        gap: 0.75rem;
        font-weight: 600;
      }

      .toggle input[type='checkbox'] {
        width: 1.25rem;
        height: 1.25rem;
      }

      p {
        margin: 0.75rem 0 0;
      }

      button {
        font: inherit;
        margin-left: 0.5rem;
      }
    `,
  ]

  constructor() {
    super()
    this.telemetry = getTelemetryPreference()
    this.supportId = this._supportIdNow()
  }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener(TelemetryPreferenceEvent.type, this._onTelemetryChanged)
    this.telemetry = getTelemetryPreference()
    this.supportId = this._supportIdNow()
  }

  override disconnectedCallback() {
    window.removeEventListener(TelemetryPreferenceEvent.type, this._onTelemetryChanged)
    super.disconnectedCallback()
  }

  _onTelemetryChanged = (event: TelemetryPreferenceEvent): void => {
    this.telemetry = event.enabled
    this.supportId = this._supportIdNow()
  }

  _supportIdNow(): string {
    return supportId()
  }

  async _copySupportId(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.supportId)
    } catch {
      // (the id is on screen to read out: copying is a convenience)
    }
  }

  /** A new id, which nothing links to the old one */
  _resetSupportId(): void {
    resetDeviceId()
    this.supportId = this._supportIdNow()
  }

  _onTelemetryToggle(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).checked
    this.telemetry = value
    setTelemetryPreference(value)
    // (the app forgets the id when it hears of this, but this page does not run the app)
    if (!value) resetDeviceId()
    this.supportId = this._supportIdNow()
  }

  override render() {
    return html`
      <label class="toggle" for="toggle-telemetry">
        <input
          type="checkbox"
          id="toggle-telemetry"
          name="usage-reports"
          ?checked=${this.telemetry}
          @change=${this._onTelemetryToggle}
        />
        <span>${t('usage-toggle')}</span>
      </label>
      ${
        this.supportId
          ? html`<p class="support-id">
              ${rich('usage-support-id', { id: this.supportId }, { code: words => html`<code id="support-id">${words}</code>` })}
              <button type="button" id="copy-support-id" @click=${this._copySupportId}>${t('storage-copy')}</button>
              <button type="button" id="reset-support-id" @click=${this._resetSupportId}>
                ${t('usage-reset')}
              </button>
            </p>
            <p>
              ${rich('usage-text', undefined, { contact: words => html`<a href="/contact">${words}</a>` })}
            </p>`
          : ''
      }
    `
  }
}

customElements.define('usage-reports-setting', UsageReportsSetting)

declare global {
  interface HTMLElementTagNameMap {
    'usage-reports-setting': UsageReportsSetting
  }
}
