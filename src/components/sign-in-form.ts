import { css, html, LitElement, nothing } from 'lit'
import { authorizeWithGoogle } from '../js/google-auth.ts'
import { t } from '../js/text.ts'
import { errorMessage, failedWith } from '../js/utils/errors.ts'
import { SignedInEvent } from './email-code-sign-in.ts'
import { buttonStyles } from './shared-styles.ts'
import './email-code-sign-in.ts'

/**
 * The one place to sign in (docs/ACCOUNT.md, "Signing in"): the form of a regular web app. An email address and Continue
 * (Chordless emails a link and a six-digit code), and below it, after "or", Continue with Google. Google is another way to
 * prove who you are, not another login: it is the same Chordless account, and it also connects Google Drive, so the
 * Personal space syncs between devices with nothing more to do.
 *
 * It is used wherever someone is asked to sign in: the Account page, the page a sign-in link lands on, and the page an invite
 * opens. Either way ends with `email-code:signed-in`, which bubbles; what to do next is the page's.
 *
 * @fires SignedInEvent - when they are signed in, by a code or by Google
 */
export class SignInForm extends LitElement {
  static override properties = {
    address: { type: String },
    next: { type: String },
    _googleError: { state: true },
    _busy: { state: true },
    _onAddressStep: { state: true },
  }

  /** The address to start from (an invite's, say); the person may change it */
  declare address: string
  /** The page the link in the email goes on to: this one, by default */
  declare next: string
  declare _googleError: string
  /** Google's window is open */
  declare _busy: boolean
  /** The email form is asking for the address (not for the code), so Google is still a way to carry on */
  declare _onAddressStep: boolean

  /** Signs in with Google, Drive included (a test gives its own) */
  google: () => Promise<unknown> = () => authorizeWithGoogle()

  constructor() {
    super()
    this.address = ''
    this.next = ''
    this._googleError = ''
    this._busy = false
    this._onAddressStep = true
  }

  static override styles = [
    buttonStyles,
    css`
    :host { display: block; }
    .or { display: flex; align-items: center; gap: 0.75rem; margin: 1rem 0; color: var(--text-secondary, #5f6b6d); }
    .or::before, .or::after { content: ''; flex: 1; border-top: 1px solid var(--border-color, #d5dbdb); }
    .google { width: 100%; }
    .note { margin: 0.5rem 0 0; font-size: var(--font-ui-small); opacity: 0.75; }
    .error { color: var(--color-danger, #e74c3c); }
    `,
  ]

  async _google(): Promise<void> {
    this._googleError = ''
    this._busy = true
    try {
      await this.google()
    } catch (error) {
      console.error('[SignInForm] Google sign-in failed:', error)
      this._googleError = failedWith(
        error,
        t('account-signin-failed', { reason: errorMessage(error) }),
        t('account-signin-failed-plain')
      )
      return
    } finally {
      this._busy = false
    }
    this.dispatchEvent(new SignedInEvent())
  }

  override render() {
    return html`
      <email-code-sign-in
        .address=${this.address}
        .next=${this.next}
        @email-code:step=${(event: CustomEvent<boolean>) => (this._onAddressStep = event.detail)}
      ></email-code-sign-in>
      ${
        this._onAddressStep
          ? html`
              <div class="or" aria-hidden="true">${t('sign-in-or')}</div>
              <button class="btn google" type="button" ?disabled=${this._busy} @click=${this._google}>
                ${t('sign-in-google')}
              </button>
              <p class="note">${t('sign-in-google-note')}</p>
              ${this._googleError ? html`<p class="error" role="alert">${this._googleError}</p>` : nothing}
            `
          : nothing
      }
    `
  }
}
customElements.define('sign-in-form', SignInForm)

declare global {
  interface HTMLElementTagNameMap {
    'sign-in-form': SignInForm
  }
}
