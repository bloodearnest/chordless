import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Space, TeamLink } from '../js/data-types.ts'
import { leaveSpace, roleWithArticle, stopSharing } from '../js/team-spaces.ts'
import { t } from '../js/text.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'

/** The owner stopped sharing the space: it is theirs alone again, and the page should read it again */
export class TeamSharingStoppedEvent extends Event {
  static readonly type = 'team-membership-panel:stopped'
  constructor() {
    super(TeamSharingStoppedEvent.type, { bubbles: true, composed: true })
  }
}

/** The person left the space, and it is gone from this device: the app should start afresh */
export class TeamLeftEvent extends Event {
  static readonly type = 'team-membership-panel:left'
  constructor() {
    super(TeamLeftEvent.type, { bubbles: true, composed: true })
  }
}

/**
 * Who the person is in a Team, and the way out of it (docs/ACCOUNT.md, "A Team's sections"): the owner can stop
 * sharing, and any other member can leave, each after a question. The people themselves, their roles and the
 * invites are the list beside it (`people-list.ts`). It shows nothing for a space that is not a Team's.
 *
 * @fires TeamSharingStoppedEvent - sharing was stopped
 * @fires TeamLeftEvent - the person left the space, which is gone from this device
 */
export class TeamMembershipPanel extends LitElement {
  static override properties = {
    space: { attribute: false },
    _error: { state: true },
    _busy: { state: true },
  }

  /** The Team's space */
  declare space: Space | null
  declare _error: string
  declare _busy: boolean

  _modal: Ref<AppModal> = createRef()

  static override styles = [
    panelStyles,
    buttonStyles,
    css`
    :host { display: block; }
    .error { color: var(--color-danger, #e74c3c); font-weight: 600; }
    .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 1rem; }
    `,
  ]

  constructor() {
    super()
    this.space = null
    this._error = ''
    this._busy = false
  }

  get _team(): TeamLink {
    return (this.space as Space).team as TeamLink
  }

  /** Do something to the space, saying what went wrong */
  async _run(work: () => Promise<void>): Promise<void> {
    this._error = ''
    this._busy = true
    try {
      await work()
    } catch (error) {
      this._error = errorMessage(error)
    } finally {
      this._busy = false
    }
  }

  async _confirm(heading: string, message: string, confirmLabel: string): Promise<boolean> {
    const modal = this._modal.value as AppModal
    modal.heading = heading
    modal.message = message
    modal.confirmLabel = confirmLabel
    await this.updateComplete
    await modal.updateComplete
    return modal.ask()
  }

  async _stopSharing(): Promise<void> {
    const space = this.space as Space
    const sure = await this._confirm(
      t('confirm-team-stop-heading'),
      t('confirm-team-stop-message'),
      t('confirm-team-stop-button')
    )
    if (!sure) return
    await this._run(async () => {
      await stopSharing(space.id)
      this.dispatchEvent(new TeamSharingStoppedEvent())
    })
  }

  async _leave(): Promise<void> {
    const space = this.space as Space
    const sure = await this._confirm(
      t('confirm-team-leave-heading', { space: space.name }),
      t('confirm-team-leave-message'),
      t('confirm-team-leave-button')
    )
    if (!sure) return
    await this._run(async () => {
      await leaveSpace(space.id)
      this.dispatchEvent(new TeamLeftEvent())
    })
  }

  override render() {
    if (!this.space?.team) return nothing
    const mine = this._team.role
    return html`
      <div class="panel">
        <h3>${t('membership-heading')}</h3>
        <p>${mine === 'owner' ? t('membership-owner') : t('membership-member', { role: roleWithArticle(mine) })}</p>
        <div class="actions">
          ${
            mine === 'owner'
              ? html`<button class="btn danger" ?disabled=${this._busy} @click=${this._stopSharing}>
                ${t('membership-stop')}
              </button>`
              : html`<button class="btn danger" ?disabled=${this._busy} @click=${this._leave}>
                ${t('membership-leave')}
              </button>`
          }
        </div>
        ${this._error ? html`<p class="error" role="alert">✗ ${this._error}</p>` : nothing}
      </div>
      <app-modal ${ref(this._modal)} type="confirm" size="small"></app-modal>
    `
  }
}
customElements.define('team-membership-panel', TeamMembershipPanel)

declare global {
  interface HTMLElementTagNameMap {
    'team-membership-panel': TeamMembershipPanel
  }
}
