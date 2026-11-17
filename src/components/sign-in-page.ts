import { css, html, LitElement } from 'lit'
import { signInWithEmail } from '../js/google-auth.ts'
import { IncomingLinkEvent, takeLink } from '../js/incoming-link.ts'
import { goTo } from '../js/navigation.ts'
import { t } from '../js/text.ts'
import './email-code-sign-in.ts'

type State = 'form' | 'working' | 'failed'

/** What a link holds: the address, the code, and the page to go on to (a path of the app, or none) */
export function readSignInLink(
  fragment: string
): { address: string; code: string; next: string } | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ''))
  const address = params.get('a')
  const code = params.get('c')
  if (!address || !code) return null
  const next = params.get('n') ?? ''
  return { address, code, next: /^\/(?![/\\])\S*$/.test(next) ? next : '/' }
}

/**
 * Where the link in the sign-in email lands (docs/SPACES.md, "Signing in with an emailed code"): it signs in with the
 * address and code in the link's #fragment, takes them out of the address bar, and goes on to the page the person was
 * on. A link that does not work (used, or run out) says so and offers to send a new one. Opened with no link, it is the
 * same form as the join page's.
 */
export class SignInPage extends LitElement {
  static override properties = {
    _state: { state: true },
    _address: { state: true },
    _next: { state: true },
  }

  declare _state: State
  declare _address: string
  declare _next: string

  /** Signs in with an address and code, and moves on (a test gives its own) */
  verify: (address: string, code: string) => Promise<void> = signInWithEmail
  go: (url: string) => unknown = goTo
  /** The link's fragment (a test gives its own) */
  // biome-ignore lint/plugin: the address and code are the link's fragment (not a route)
  fragment: string = window.location.hash

  constructor() {
    super()
    this._state = 'form'
    this._address = ''
    this._next = '/'
  }

  static override styles = css`
    :host { display: block; flex: 1; min-height: 0; overflow-y: auto; color: var(--text-color); }
    .page { max-width: 600px; margin: 0 auto; padding: 2rem 1rem; }
    h2 { margin: 0 0 1rem; font-size: var(--font-ui); }
    .error { color: var(--color-danger, #e74c3c); }
  `

  override connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener(IncomingLinkEvent.type, this._onLink)
    void this._open(takeLink('/sign-in') ?? this.fragment)
  }

  override disconnectedCallback(): void {
    window.removeEventListener(IncomingLinkEvent.type, this._onLink)
    super.disconnectedCallback()
  }

  /** A link the installed app was launched with while this page is open */
  _onLink = (): void => {
    const fragment = takeLink('/sign-in')
    if (fragment) void this._open(fragment)
  }

  async _open(fragment: string): Promise<void> {
    const link = readSignInLink(fragment)
    if (!link) return
    // (the code is used once: it does not stay in the address bar, or the history)
    history.replaceState(history.state, '', window.location.pathname)
    this._address = link.address
    this._next = link.next
    this._state = 'working'
    try {
      await this.verify(link.address, link.code)
    } catch {
      this._state = 'failed'
      return
    }
    await this.go(link.next)
  }

  _signedIn = (): void => {
    void this.go(this._next)
  }

  override render() {
    return html`
      <div class="page">
        <h2>${t('email-code-heading')}</h2>
        ${
          this._state === 'working'
            ? html`<p role="status">${t('email-link-working')}</p>`
            : html`
                ${
                  this._state === 'failed'
                    ? html`<p class="error" role="alert">${t('email-link-failed')}</p>`
                    : html`<p>${t('email-link-none')}</p>`
                }
                <email-code-sign-in
                  .address=${this._address}
                  .next=${this._next === '/' ? '' : this._next}
                  @email-code:signed-in=${this._signedIn}
                ></email-code-sign-in>
              `
        }
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
