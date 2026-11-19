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

/** Whether the form is asking for the address (and not for the code), so that what sits beside it can come and go with that */
export class StepEvent extends Event {
  static readonly type = 'email-code:step'
  readonly askingForAddress: boolean
  constructor(askingForAddress: boolean) {
    super(StepEvent.type, { bubbles: true, composed: true })
    this.askingForAddress = askingForAddress
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
    next: { type: String },
    _step: { state: true },
    _error: { state: true },
    _sent: { state: true },
  }

  /** The address to start from (an invite's, say); the person may change it */
  declare address: string
  /** The page the link in the email goes on to: this one, by default */
  declare next: string
  declare _step: Step
  declare _error: string
  /** Whether a code was just asked for (not one they already have, from an earlier email) */
  declare _sent: boolean

  /** Asks for the code to be mailed, and signs in with it (a test gives its own) */
  start: (address: string, next?: string) => Promise<void> = startEmailSignIn
  verify: (address: string, code: string) => Promise<void> = signInWithEmail

  constructor() {
    super()
    this.address = ''
    this.next = ''
    this._step = 'address'
    this._error = ''
    this._sent = false
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

  override willUpdate(changed: Map<string, unknown>): void {
    // (the form says whether it is asking for the address, so that what sits beside it, Google, can be shown with it only)
    if (changed.has('_step')) {
      this.dispatchEvent(new StepEvent(this._step === 'address' || this._step === 'sending'))
    }
  }

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
      await this.start(this.address, this.next || undefined)
      this._sent = true
      this._step = 'code'
    } catch (error) {
      this._error = this._explain(error, 'email-code-error-send')
      // (a failed resend leaves them at the code box)
      this._step = from === 'code' ? 'code' : 'address'
    }
  }

  /** Go straight to the code box for a code they already have (an earlier email, or a link that showed it), asking for none */
  _haveCode(): void {
    const input = this.renderRoot.querySelector<HTMLInputElement>('input[name=address]')
    this.address = (input as HTMLInputElement).value.trim()
    if (!input?.checkValidity()) {
      this._error = t('email-code-error-address')
      return
    }
    this._error = ''
    this._sent = false
    this._step = 'code'
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
          <p role="status">${this._sent ? t('email-code-sent', { email: this.address }) : t('email-code-enter', { email: this.address })}</p>
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
          <button class="btn" type="button" ?disabled=${sending} @click=${this._haveCode}>
            ${t('email-code-have')}
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
