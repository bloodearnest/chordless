import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Space } from '../js/data-types.ts'
import { defaultSpaceOf, setDefaultSpaceId } from '../js/default-space.ts'
import type { SignInState } from '../js/google-auth.ts'
import { goTo } from '../js/navigation.ts'
import { getCurrentSpace, listSpaces } from '../js/space.ts'
import { checkTeamMemberships, TeamSpacesAddedEvent } from '../js/team-memberships.ts'
import { t } from '../js/text.ts'
import { toast } from '../js/toast.ts'
import { errorMessage } from '../js/utils/errors.ts'
import { AccountStateEvent } from './account-card.ts'
import './account-card.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'
import {
  SpaceConnectGoogleEvent,
  SpaceDataEvent,
  SpaceDefaultEvent,
  SpaceManageEvent,
  SpaceSyncedEvent,
} from './space-card.ts'
import './space-card.ts'
import { SpaceGoneEvent } from './space-manager.ts'
import './space-manager.ts'
import './storage-summary.ts'

/**
 * Account and Teams (docs/ACCOUNT.md): who is signed in, then the Personal space and the Teams on
 * this device, each with its size, when it last synced, and switch and sync; everything else for a
 * space is on its own page, under "Manage Users" (space-page.ts), and its data under "Manage Data" (a dialogue). Making a Team is
 * rare, so it is under them. The device's own usage is last.
 */
export class AccountPage extends LitElement {
  static override properties = {
    _spaces: { state: true },
    _currentId: { state: true },
    _defaultId: { state: true },
    _signIn: { state: true },
    _emailOnly: { state: true },
    _data: { state: true },
    _looking: { state: true },
    _lookMessage: { state: true },
  }

  declare _spaces: Space[]
  /** The space whose data is shown, while its dialogue is open */
  declare _data: Space | null
  _dataModal: Ref<AppModal> = createRef()
  /** Whether it is asking which teams the person is in, and what it found */
  declare _looking: boolean
  declare _lookMessage: string
  declare _currentId: string | null
  /** The default space (docs/SPACES.md, "Presenting spaces") */
  declare _defaultId: string | null
  declare _signIn: SignInState | null
  /** Signed in with an emailed code alone */
  declare _emailOnly: boolean
  /** Shows the space once it is the one in use (a test gives its own; by default the home page, afresh) */
  show: (() => unknown) | undefined = undefined
  /** Moves on to another page (a test gives its own) */
  go: (url: string) => unknown = goTo

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
      .people { padding: 1rem; max-width: 800px; margin: 0 auto; }
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
    this._defaultId = null
    this._signIn = null
    this._emailOnly = false
    this._data = null
    this._looking = false
    this._lookMessage = ''
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener(AccountStateEvent.type, this._onAccount)
    this.addEventListener(SpaceSyncedEvent.type, this._onSynced)
    this.addEventListener(SpaceDefaultEvent.type, this._onDefault)
    this.addEventListener(SpaceManageEvent.type, this._onManage)
    this.addEventListener(SpaceDataEvent.type, this._onData)
    this.addEventListener(SpaceGoneEvent.type, this._onGone)
    this.addEventListener(SpaceConnectGoogleEvent.type, this._onConnectGoogle)
    window.addEventListener(TeamSpacesAddedEvent.type, this._onTeamsAdded)
    void this.load()
  }

  override disconnectedCallback(): void {
    this.removeEventListener(AccountStateEvent.type, this._onAccount)
    this.removeEventListener(SpaceSyncedEvent.type, this._onSynced)
    this.removeEventListener(SpaceDefaultEvent.type, this._onDefault)
    this.removeEventListener(SpaceManageEvent.type, this._onManage)
    this.removeEventListener(SpaceDataEvent.type, this._onData)
    this.removeEventListener(SpaceGoneEvent.type, this._onGone)
    this.removeEventListener(SpaceConnectGoogleEvent.type, this._onConnectGoogle)
    window.removeEventListener(TeamSpacesAddedEvent.type, this._onTeamsAdded)
    super.disconnectedCallback()
  }

  /** Asks which teams the person is in and sets up the ones missing (a test gives its own) */
  checkTeams: typeof checkTeamMemberships = checkTeamMemberships

  /** Teams were set up on this device (by the check at start-up or the button): list them */
  _onTeamsAdded = (): void => {
    void this.load()
  }

  /** Ask which teams the person is in, including any taken off this device, and set up what is missing */
  async _lookForTeams(): Promise<void> {
    this._looking = true
    this._lookMessage = ''
    try {
      const { added } = await this.checkTeams({ force: true, includeDeclined: true })
      this._lookMessage = added.length
        ? t('account-teams-added', { names: added.map(space => space.name).join(', ') })
        : t('account-teams-all-here')
    } catch (error) {
      this._lookMessage = t('account-teams-look-failed', {
        reason: error instanceof Error ? error.message : String(error),
      })
    }
    this._looking = false
  }

  _onAccount = (event: Event): void => {
    this._signIn = (event as AccountStateEvent).state
    this._emailOnly = (event as AccountStateEvent).emailOnly
  }

  /** A sync can rename a personal space (after its owner), so read the list again */
  _onSynced = (): void => {
    void this.load()
  }

  _onDefault = (event: Event): void => {
    const id = (event as SpaceDefaultEvent).spaceId
    setDefaultSpaceId(id)
    this._defaultId = id
  }

  /** Connects Google to the account (a test gives its own) */
  connectGoogle: () => Promise<unknown> = async () => {
    const { authorizeWithGoogle } = await import('../js/google-auth.ts')
    return authorizeWithGoogle()
  }

  /** A Personal space's card asked to sync it between devices: Google is connected, and the sign-in read again */
  _onConnectGoogle = async (): Promise<void> => {
    try {
      await this.connectGoogle()
    } catch (error) {
      console.error('[AccountPage] Connecting Google failed:', error)
      toast(t('toast-connect-google-failed'), { kind: 'error', details: errorMessage(error) })
    }
    await this.shadowRoot?.querySelector('account-card')?.refresh()
  }

  /** A space's data (export, import, reset from Drive, delete) in a dialogue over the list */
  _onData = async (event: Event): Promise<void> => {
    const space = this._spaces.find(each => each.id === (event as SpaceDataEvent).spaceId)
    if (!space) return
    this._data = space
    await this.updateComplete
    this._dataModal.value?.show()
  }

  _onDataClosed = (event: Event): void => {
    // (not if it was opened again while it was closing: that is another space's)
    if (event.target === this._dataModal.value && !this._dataModal.value.open) this._data = null
  }

  /** A space was deleted from this device: the dialogue closes, and the app starts afresh if it was in use */
  _onGone = (event: Event): void => {
    this._dataModal.value?.close()
    this._data = null
    void this.load()
    if (!(event as SpaceGoneEvent).wasCurrent) return
    void (this.show ? this.show() : goTo('/', { fresh: true }))
  }

  /** A space's users are on its own page */
  _onManage = (event: Event): void => {
    void this.go(`/account/space/${encodeURIComponent((event as SpaceManageEvent).spaceId)}`)
  }

  /**
   * The spaces on this device, in the order they were added, so the list stays put whichever is in
   * use: the Personal space, made first, is always first
   */
  async load(): Promise<void> {
    const spaces = await listSpaces()
    spaces.sort((a, b) => a.createdDate.localeCompare(b.createdDate) || a.id.localeCompare(b.id))
    this._currentId = getCurrentSpace().id
    this._defaultId = defaultSpaceOf(spaces)?.id ?? null
    this._spaces = spaces
  }

  override render() {
    return html`
      <div class="content">
        <account-card></account-card>
        <h2>${t('account-spaces-heading')}</h2>
        <div class="spaces">
          ${this._spaces.map(
            space => html`<space-card
              .space=${space}
              .signIn=${this._signIn}
              ?emailOnly=${this._emailOnly}
              ?current=${space.id === this._currentId}
              ?isDefault=${space.id === this._defaultId}
              ?several=${this._spaces.length > 1}
            ></space-card>`
          )}
        </div>
        <p class="hint">${t('account-join-hint')}</p>
        <a class="btn" id="create-team" href="/account/new">${t('account-create-team')}</a>
        ${
          this._signIn === 'signed-in'
            ? html`<button class="btn" id="look-for-teams" ?disabled=${this._looking} @click=${this._lookForTeams}>
                ${this._looking ? t('account-teams-looking') : t('account-teams-look')}
              </button>
              <p class="hint" id="look-message" role="status">
                ${this._lookMessage || t('account-teams-look-hint')}
              </p>`
            : nothing
        }
        <div class="panel">
          <h3>${t('account-device-heading')}</h3>
          <storage-summary></storage-summary>
        </div>
      </div>
      <app-modal
        ${ref(this._dataModal)}
        size="large"
        heading=${this._data ? t('space-data-heading', { name: this._data.name }) : ''}
        @app-modal:close=${this._onDataClosed}
      >
        ${this._data ? html`<space-manager .spaceId=${this._data.id}></space-manager>` : nothing}
      </app-modal>
    `
  }
}
customElements.define('account-page', AccountPage)

declare global {
  interface HTMLElementTagNameMap {
    'account-page': AccountPage
  }
}
