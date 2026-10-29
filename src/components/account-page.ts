import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Space } from '../js/data-types.ts'
import type { SignInState } from '../js/google-auth.ts'
import { getCurrentSpace, listSpaces, switchSpace } from '../js/space.ts'
import { AccountStateEvent } from './account-card.ts'
import './account-card.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'
import {
  SpaceLeadersEvent,
  SpaceManageEvent,
  SpaceSwitchEvent,
  SpaceSyncedEvent,
  SpaceUsersEvent,
} from './space-card.ts'
import './space-card.ts'
import { SpaceGoneEvent } from './space-manager.ts'
import './space-manager.ts'
import './storage-summary.ts'
import { TeamShareLeftEvent } from './team-share-panel.ts'
import './team-share-panel.ts'
import './space-people.ts'

/**
 * Account and Teams (docs/ACCOUNT.md): who is signed in, then the Personal space and the Teams on
 * this device, each with its size, when it last synced, and switch and sync; everything else for a
 * space is under "Data", and a Team's people under "Users", each in a modal over the list like the
 * app's other settings. Making a Team is
 * rare, so it is under them. The device's own usage is last.
 */
export class AccountPage extends LitElement {
  static override properties = {
    _spaces: { state: true },
    _currentId: { state: true },
    _signIn: { state: true },
    _managing: { state: true },
    _users: { state: true },
    _leaders: { state: true },
  }

  declare _spaces: Space[]
  declare _currentId: string | null
  declare _signIn: SignInState | null
  /** The space being managed, while its modal is open */
  declare _managing: Space | null
  /** The Team whose people are shown, while their modal is open */
  declare _users: Space | null
  declare _leaders: Space | null

  _modal: Ref<AppModal> = createRef()
  _usersModal: Ref<AppModal> = createRef()
  _leadersModal: Ref<AppModal> = createRef()

  /** Shows the space once it is the one in use (a test gives its own; by default the home page, afresh) */
  show: (() => unknown) | undefined = undefined

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
    this._signIn = null
    this._managing = null
    this._users = null
    this._leaders = null
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener(AccountStateEvent.type, this._onAccount)
    this.addEventListener(SpaceSyncedEvent.type, this._onSynced)
    this.addEventListener(SpaceSwitchEvent.type, this._onSwitch)
    this.addEventListener(SpaceManageEvent.type, this._onManage)
    this.addEventListener(SpaceUsersEvent.type, this._onUsers)
    this.addEventListener(SpaceLeadersEvent.type, this._onLeaders)
    this.addEventListener(TeamShareLeftEvent.type, this._onLeft)
    this.addEventListener(SpaceGoneEvent.type, this._onGone)
    void this.load()
  }

  override disconnectedCallback(): void {
    this.removeEventListener(AccountStateEvent.type, this._onAccount)
    this.removeEventListener(SpaceSyncedEvent.type, this._onSynced)
    this.removeEventListener(SpaceSwitchEvent.type, this._onSwitch)
    this.removeEventListener(SpaceManageEvent.type, this._onManage)
    this.removeEventListener(SpaceUsersEvent.type, this._onUsers)
    this.removeEventListener(SpaceLeadersEvent.type, this._onLeaders)
    this.removeEventListener(TeamShareLeftEvent.type, this._onLeft)
    this.removeEventListener(SpaceGoneEvent.type, this._onGone)
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
    void switchSpace((event as SpaceSwitchEvent).spaceId, this.show)
  }

  /** Show everything to do with a space in a modal */
  _onManage = async (event: Event): Promise<void> => {
    const id = (event as SpaceManageEvent).spaceId
    const space = this._spaces.find(each => each.id === id)
    if (!space) return
    this._managing = space
    await this.updateComplete
    this._modal.value?.show()
  }

  /** Show a Team's people in a modal */
  _onUsers = async (event: Event): Promise<void> => {
    const id = (event as SpaceUsersEvent).spaceId
    const space = this._spaces.find(each => each.id === id)
    if (!space?.team) return
    this._users = space
    await this.updateComplete
    this._usersModal.value?.show()
  }

  /** Show who leads a space's setlists in a modal */
  _onLeaders = async (event: Event): Promise<void> => {
    const id = (event as SpaceLeadersEvent).spaceId
    const space = this._spaces.find(each => each.id === id)
    if (!space) return
    this._leaders = space
    await this.updateComplete
    this._leadersModal.value?.show()
  }

  _onLeadersClosed = (event: Event): void => {
    if (event.target !== this._leadersModal.value) return
    this._leaders = null
  }

  /** The person left the Team, which is gone from this device: close the modal, and read the list again */
  _onLeft = (): void => {
    this._usersModal.value?.close()
  }

  /** The people's modal closed, however: sharing may have stopped, so the cards may have changed */
  _onUsersClosed = (event: Event): void => {
    if (event.target !== this._usersModal.value) return
    this._users = null
    void this.load()
  }

  /** The space was deleted: close its modal, and read the list again */
  _onGone = (): void => {
    this._modal.value?.close()
  }

  /** The modal closed, however: what was done in it may have changed the cards */
  _onClosed = (event: Event): void => {
    // (a question asked inside it closes too, and tells the same way: only its own close counts)
    if (event.target !== this._modal.value) return
    this._managing = null
    void this.load()
  }

  /**
   * The spaces on this device, in the order they were added, so the list stays put whichever is in
   * use: the Personal space, made first, is always first
   */
  async load(): Promise<void> {
    const spaces = await listSpaces()
    spaces.sort((a, b) => a.createdDate.localeCompare(b.createdDate) || a.id.localeCompare(b.id))
    this._currentId = getCurrentSpace().id
    this._spaces = spaces
  }

  override render() {
    return html`
      <div class="content">
        <account-card></account-card>
        <h2>Personal and Team Spaces</h2>
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
      <app-modal
        ${ref(this._modal)}
        size="large"
        heading=${this._managing?.name ?? ''}
        @app-modal:close=${this._onClosed}
      >
        ${
          this._managing
            ? html`<space-manager .spaceId=${this._managing.id}></space-manager>`
            : nothing
        }
      </app-modal>
      <app-modal
        ${ref(this._usersModal)}
        size="large"
        heading=${this._users ? `${this._users.name}: people` : ''}
        @app-modal:close=${this._onUsersClosed}
      >
        ${
          this._users
            ? html`<div class="people">
              <team-share-panel
                .space=${this._users}
                @team-share-panel:changed=${() => this._usersModal.value?.close()}
              ></team-share-panel>
            </div>`
            : nothing
        }
      </app-modal>
      <app-modal
        ${ref(this._leadersModal)}
        size="large"
        heading=${this._leaders ? `${this._leaders.name}: leaders` : ''}
        @app-modal:close=${this._onLeadersClosed}
      >
        ${this._leaders ? html`<space-people .spaceId=${this._leaders.id}></space-people>` : nothing}
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
