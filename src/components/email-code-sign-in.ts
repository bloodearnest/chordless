import { css, html, LitElement, nothing } from 'lit'
import { EmailCodeError, signInWithEmail, startEmailSignIn } from '../js/google-auth.ts'
import { t } from '../js/text.ts'
import { buttonStyles, fieldStyles } from './shared-styles.ts'

/** The code was right: they are signed in */
export class SignedInEvent extends Event {
  static readonly type = 'email-code:signed-in'
  constructor() {
    super(SignedInEvent.type, { bubbles: true, composed: true })
  }
}

type Step = 'address' | 'sending' | 'code' | 'checking'

/**
 * Signing in with an emailed code, for someone with no Google account (docs/SPACES.md, "Signing in without
 * Google"): the address, then the six-digit code Chordless mails to it. Fires `signed-in` when it works. The
 * answer to asking for a code is the same for any address, so nothing here says whether one has an account.
 */
export class EmailCodeSignIn extends LitElement {
  static override properties = {
    address: { type: String },
    _step: { state: true },
    _error: { state: true },
  }

  /** The address to start from (an invite's, say); the person may change it */
  declare address: string
  declare _step: Step
  declare _error: string

  /** Asks for the code to be mailed, and signs in with it (a test gives its own) */
  start: (address: string) => Promise<void> = startEmailSignIn
  verify: (address: string, code: string) => Promise<void> = signInWithEmail

  constructor() {
    super()
    this.address = ''
    this._step = 'address'
    this._error = ''
  }

  static override styles = [
    buttonStyles,
    fieldStyles,
    css`
    :host { display: block; }
    label { display: block; margin: 0 0 0.35rem; }
    form { margin: 0 0 1rem; }
    .error { color: var(--color-danger, #e74c3c); }
    .code { letter-spacing: 0.3em; font-variant-numeric: tabular-nums; max-width: 12rem; }
    `,
  ]

  _explain(error: unknown, fallback: string): string {
    if (!(error instanceof EmailCodeError)) return t(fallback)
    switch (error.reason) {
      case 'invalid_address':
        return t('email-code-error-address')
      case 'too_often':
        return t('email-code-error-too-often')
      case 'wrong':
        return t('email-code-error-wrong')
      case 'expired':
        return t('email-code-error-expired')
      case 'too_many':
        return t('email-code-error-too-many')
      default:
        return t(fallback)
    }
  }

  async _send(event?: Event): Promise<void> {
    event?.preventDefault()
    const input = this.renderRoot.querySelector<HTMLInputElement>('input[name=address]')
    if (input) this.address = input.value.trim()
    this._error = ''
    const from = this._step
    this._step = 'sending'
    try {
      await this.start(this.address)
      this._step = 'code'
    } catch (error) {
      this._error = this._explain(error, 'email-code-error-send')
      // (a failed resend leaves them at the code box)
      this._step = from === 'code' ? 'code' : 'address'
    }
  }

  async _submit(event: Event): Promise<void> {
    event.preventDefault()
    const input = this.renderRoot.querySelector<HTMLInputElement>('input[name=code]')
    const code = (input as HTMLInputElement).value.replace(/\s/g, '')
    this._error = ''
    this._step = 'checking'
    try {
      await this.verify(this.address, code)
    } catch (error) {
      this._error = this._explain(error, 'email-code-error-failed')
      // (a code that cannot be used again is no reason to leave the box for it)
      this._step = 'code'
      return
    }
    this.dispatchEvent(new SignedInEvent())
  }

  override render() {
    const error = this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing
    if (this._step === 'code' || this._step === 'checking') {
      const busy = this._step === 'checking'
      return html`
        <form @submit=${this._submit}>
          <p role="status">${t('email-code-sent', { email: this.address })}</p>
          <label for="code">${t('email-code-label')}</label>
          <input
            id="code"
            name="code"
            class="field code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="7"
            required
            ?disabled=${busy}
          />
          ${error}
          <div class="actions">
            <button class="btn primary" type="submit" ?disabled=${busy}>
              ${busy ? t('email-code-checking') : t('email-code-submit')}
            </button>
            <button class="btn" type="button" ?disabled=${busy} @click=${this._send}>
              ${t('email-code-resend')}
            </button>
            <button
              class="btn"
              type="button"
              ?disabled=${busy}
              @click=${() => {
                this._error = ''
                this._step = 'address'
              }}
            >
              ${t('email-code-other-address')}
            </button>
          </div>
        </form>
      `
    }
    const sending = this._step === 'sending'
    return html`
      <form @submit=${this._send}>
        <label for="address">${t('email-code-address-label')}</label>
        <input
          id="address"
          name="address"
          class="field"
          type="email"
          autocomplete="email"
          required
          .value=${this.address}
          ?disabled=${sending}
        />
        ${error}
        <div class="actions">
          <button class="btn primary" type="submit" ?disabled=${sending}>
            ${sending ? t('email-code-sending') : t('email-code-send')}
          </button>
        </div>
      </form>
    `
  }
}
customElements.define('email-code-sign-in', EmailCodeSignIn)

declare global {
  interface HTMLElementTagNameMap {
    'email-code-sign-in': EmailCodeSignIn
  }
}
