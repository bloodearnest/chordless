import { css, html, LitElement } from 'lit'
import type { Space } from '../js/data-types.ts'
import type { SignInState } from '../js/google-auth.ts'
import { getCurrentSpace, listSpaces, switchSpace } from '../js/space.ts'
import { AccountStateEvent } from './account-card.ts'
import './account-card.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'
import { SpaceSwitchEvent, SpaceSyncedEvent } from './space-card.ts'
import './space-card.ts'
import './storage-summary.ts'

/**
 * Account and Teams (docs/ACCOUNT.md): who is signed in, then the Personal space and the Teams on
 * this device, each with its size, when it last synced, and sync and switch; everything else for a
 * space is on its own page. Making a Team is rare, so it is under them. The device's own usage is
 * last.
 */
export class AccountPage extends LitElement {
  static override properties = {
    _spaces: { state: true },
    _currentId: { state: true },
    _signIn: { state: true },
  }

  declare _spaces: Space[]
  declare _currentId: string | null
  declare _signIn: SignInState | null

  /** Starts the app afresh in the space switched to (a test gives its own) */
  /* v8 ignore next 3 -- reloading the page would end the test run: tests give their own */
  // biome-ignore lint/plugin: the database is another space's now, so start afresh
  reload: () => void = () => window.location.reload()

  static override styles = [
    panelStyles,
    buttonStyles,
    css`
      :host {
        display: block;
      }
      .content {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        max-width: 800px;
        margin: 0 auto;
      }
      h2 {
        font-size: var(--font-ui);
        margin: 0.5rem 0 0;
      }
      .spaces {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .hint {
        font-size: var(--font-ui-small);
        opacity: 0.75;
        margin: 0;
      }
      a.btn {
        text-decoration: none;
        align-self: flex-start;
      }
    `,
  ]

  constructor() {
    super()
    this._spaces = []
    this._currentId = null
    this._signIn = null
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener(AccountStateEvent.type, this._onAccount)
    this.addEventListener(SpaceSyncedEvent.type, this._onSynced)
    this.addEventListener(SpaceSwitchEvent.type, this._onSwitch)
    void this.load()
  }

  override disconnectedCallback(): void {
    this.removeEventListener(AccountStateEvent.type, this._onAccount)
    this.removeEventListener(SpaceSyncedEvent.type, this._onSynced)
    this.removeEventListener(SpaceSwitchEvent.type, this._onSwitch)
    super.disconnectedCallback()
  }

  _onAccount = (event: Event): void => {
    this._signIn = (event as AccountStateEvent).state
  }

  /** A sync can rename a personal space (after its owner), so read the list again */
  _onSynced = (): void => {
    void this.load()
  }

  _onSwitch = (event: Event): void => {
    void switchSpace((event as SpaceSwitchEvent).spaceId, this.reload)
  }

  /** The spaces on this device, the one in use first */
  async load(): Promise<void> {
    const current = getCurrentSpace().id
    const spaces = await listSpaces()
    spaces.sort((a, b) => Number(b.id === current) - Number(a.id === current))
    this._currentId = current
    this._spaces = spaces
  }

  override render() {
    return html`
      <div class="content">
        <account-card></account-card>
        <h2>Personal and Teams</h2>
        <div class="spaces">
          ${this._spaces.map(
            space => html`<space-card
              .space=${space}
              .signIn=${this._signIn}
              ?current=${space.id === this._currentId}
            ></space-card>`
          )}
        </div>
        <p class="hint">To join a Team, open the invite link its admin sent you.</p>
        <a class="btn" id="create-team" href="/account/new">Create a new Team</a>
        <div class="panel">
          <h3>This device</h3>
          <storage-summary></storage-summary>
        </div>
      </div>
    `
  }
}
customElements.define('account-page', AccountPage)

declare global {
  interface HTMLElementTagNameMap {
    'account-page': AccountPage
  }
}
