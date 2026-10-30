import { css, html, LitElement } from 'lit'
import { appUpdate } from '../js/app-update.ts'
import {
  CONTACT_ADDRESS,
  emailBody,
  emailLink,
  type SupportInfo,
  supportDetails,
} from '../js/contact.ts'
import { deviceDetails } from '../js/telemetry/device.ts'
import { supportId } from '../js/telemetry/ids.ts'
import { buttonStyles, fieldStyles, panelStyles } from './shared-styles.ts'

const SUBJECT = 'Chordless'

/**
 * AppContact
 *
 * A way to reach us that brings the Support ID and the device with it, so that nobody has to look
 * them up. It makes an email (there is no server for messages: Chordless keeps none), with the
 * details under what the person wrote. They can read what is added, and copy it to use another way.
 */
export class AppContact extends LitElement {
  static override properties = {
    _message: { state: true },
    _version: { state: true },
    _copied: { state: true },
  }

  declare _message: string
  declare _version: string
  declare _copied: boolean

  static override styles = [
    panelStyles,
    buttonStyles,
    fieldStyles,
    css`
      :host {
        display: block;
      }

      .contact-content {
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
        min-height: 8em;
        resize: vertical;
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
    `,
  ]

  constructor() {
    super()
    this._message = ''
    this._version = ''
    this._copied = false
  }

  override connectedCallback() {
    super.connectedCallback()
    void appUpdate
      .runningVersion()
      .then(running => {
        this._version = running?.version ?? ''
      })
      .catch(() => {
        // (no version to give: the details say it is unknown)
      })
  }

  /** What is known now: the window can be turned or resized, and the network can go, while this is open */
  _info(): SupportInfo {
    return {
      supportId: supportId(),
      version: this._version,
      device: deviceDetails(),
      online: navigator.onLine,
      userAgent: navigator.userAgent,
    }
  }

  async _copyDetails(): Promise<void> {
    try {
      await navigator.clipboard.writeText(supportDetails(this._info()))
      this._copied = true
      setTimeout(() => {
        this._copied = false
      }, 2000)
    } catch {
      // (the details are on screen to read out, or to select)
    }
  }

  _onInput(event: Event): void {
    this._message = (event.target as HTMLTextAreaElement).value
  }

  override render() {
    const details = supportDetails(this._info())
    const link = emailLink(
      SUBJECT,
      emailBody(this._message, details),
      typeof navigator.share === 'function'
    )
    return html`
      <div class="contact-content">
        <div class="panel">
          <h3>Tell us</h3>
          <p>
            A problem, a song that does not look right, or an idea. This starts an email to
            ${CONTACT_ADDRESS}, which you send yourself: Chordless keeps no messages.
          </p>
          <label for="contact-message">Your message</label>
          <textarea
            id="contact-message"
            class="field"
            .value=${this._message}
            @input=${this._onInput}
          ></textarea>
        </div>

        <div class="panel">
          <h3>What goes with it</h3>
          <p>
            So we do not have to ask. It is added under your message, and says nothing about your
            songs.
          </p>
          <pre id="contact-details">${details}</pre>
          <div class="actions">
            <a id="contact-send" class="btn primary" href=${link} target="_blank" rel="noopener">
              Write the email
            </a>
            <button type="button" id="contact-copy" class="btn" @click=${this._copyDetails}>
              ${this._copied ? 'Copied' : 'Copy the details'}
            </button>
          </div>
        </div>
      </div>
    `
  }
}
customElements.define('app-contact', AppContact)

declare global {
  interface HTMLElementTagNameMap {
    'app-contact': AppContact
  }
}
