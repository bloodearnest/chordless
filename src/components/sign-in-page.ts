import { css, html, LitElement } from 'lit'
import { peekSignInLink, signInWithLink } from '../js/google-auth.ts'
import { type JoinDevice, joinDevice } from '../js/join-device.ts'
import { goTo } from '../js/navigation.ts'
import type { Route } from '../js/router.ts'
import { t } from '../js/text.ts'
import { buttonStyles } from './shared-styles.ts'
import './email-code-sign-in.ts'

type State = 'form' | 'working' | 'failed' | 'choose' | 'code'

/**
 * Where the link in the sign-in email lands: /sign-in/<id> (docs/SPACES.md, "Signing in with an emailed code"). The
 * link signs in the browser that opens it, which is what the person wants unless they are signing in to an app
 * installed from that browser's Home Screen: on iOS such an app has storage of its own, apart from Safari's, and a
 * link from Mail opens in Safari, never in the app. So on iOS it asks first, and does not use the link up until
 * told to: "sign in here", or "show me the code" to enter in the app (it is the same code that is in the email).
 * Anywhere else it signs in at once, and goes on to the page the person was on. A link that does not work (used,
 * replaced by a newer code, or three days old) says so and offers the form to ask for a new one. With no link it
 * is that form.
 */
export class SignInPage extends LitElement {
  static override properties = {
    route: { attribute: false },
    _state: { state: true },
    _address: { state: true },
    _code: { state: true },
    _copied: { state: true },
  }

  declare route: Route | undefined
  declare _state: State
  declare _address: string
  declare _code: string
  declare _copied: boolean

  /** Signs in with a link, and says where to go on to; shows what a link is for (a test gives its own) */
  signIn: (id: string) => Promise<string> = signInWithLink
  peek: (id: string) => Promise<{ address: string; code: string; next: string }> = peekSignInLink
  go: (url: string) => unknown = goTo
  /* v8 ignore next -- the browser's own clipboard; a test gives its own */
  copyText: (text: string) => Promise<void> = text => navigator.clipboard.writeText(text)
  /** The device, and whether this is the installed app itself (a test gives its own) */
  device: JoinDevice = joinDevice()
  standalone: boolean = window.matchMedia('(display-mode: standalone)').matches

  constructor() {
    super()
    this._state = 'form'
    this._address = ''
    this._code = ''
    this._copied = false
  }

  static override styles = [
    buttonStyles,
    css`
    :host { display: block; flex: 1; min-height: 0; overflow-y: auto; color: var(--text-color); }
    .page { max-width: 600px; margin: 0 auto; padding: 2rem 1rem; }
    h2 { margin: 0 0 1rem; font-size: var(--font-ui); }
    .error { color: var(--color-danger, #e74c3c); }
    .code { font-size: 2rem; letter-spacing: 0.3em; font-variant-numeric: tabular-nums; margin: 0.5rem 0; }
    `,
  ]

  get _linkId(): string | undefined {
    return this.route?.name === 'sign-in' ? this.route.linkId : undefined
  }

  override connectedCallback(): void {
    super.connectedCallback()
    if (!this._linkId) return
    // (an iPhone's installed app is not where Mail opens a link: ask before the link is used up)
    if (this.device.os === 'ios' && !this.standalone) this._state = 'choose'
    else void this._signIn()
  }

  async _signIn(): Promise<void> {
    this._state = 'working'
    try {
      const next = await this.signIn(this._linkId as string)
      await this.go(next)
    } catch {
      this._state = 'failed'
    }
  }

  async _showCode(): Promise<void> {
    try {
      const { address, code } = await this.peek(this._linkId as string)
      this._address = address
      this._code = code
      this._state = 'code'
      try {
        await this.copyText(code)
        this._copied = true
      } catch {
        // (the code is on the page, to copy by hand)
        this._copied = false
      }
    } catch {
      this._state = 'failed'
    }
  }

  _signedIn = (): void => {
    void this.go('/')
  }

  _renderState() {
    switch (this._state) {
      case 'working':
        return html`<p role="status">${t('email-link-working')}</p>`
      case 'choose':
        return html`
          <p>${t('email-link-choose')}</p>
          <div class="actions">
            <button class="btn primary" @click=${this._signIn}>${t('email-link-here')}</button>
            <button class="btn" @click=${this._showCode}>${t('email-link-app')}</button>
          </div>
        `
      case 'code':
        return html`
          <p>${t('email-link-code-intro', { email: this._address })}</p>
          <p class="code" aria-label=${t('email-code-label')}>${this._code}</p>
          <p role="status">${this._copied ? t('email-link-copied') : t('email-link-copy-by-hand')}</p>
          <p>${t('email-link-code-steps')}</p>
        `
      case 'failed':
        return html`
          <p class="error" role="alert">${t('email-link-failed')}</p>
          <email-code-sign-in @email-code:signed-in=${this._signedIn}></email-code-sign-in>
        `
      default:
        return html`
          <p>${t('email-link-none')}</p>
          <email-code-sign-in @email-code:signed-in=${this._signedIn}></email-code-sign-in>
        `
    }
  }

  override render() {
    return html`
      <div class="page">
        <h2>${t('email-code-heading')}</h2>
        ${this._renderState()}
      </div>
    `
  }
}
customElements.define('sign-in-page', SignInPage)

declare global {
  interface HTMLElementTagNameMap {
    'sign-in-page': SignInPage
  }
}
