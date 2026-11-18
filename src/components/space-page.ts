import { css, html, LitElement, nothing } from 'lit'
import type { Space } from '../js/data-types.ts'
import { goTo } from '../js/navigation.ts'
import type { Route } from '../js/router.ts'
import { getSpaceById } from '../js/space.ts'
import { spaceKind, spaceRole } from '../js/space-label.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'
import './people-list.ts'
import './team-licence-panel.ts'
import { TeamLeftEvent, TeamSharingStoppedEvent } from './team-membership-panel.ts'
import './team-membership-panel.ts'
import './team-storage-panel.ts'

/**
 * Everything about one space, on a page of its own (docs/ACCOUNT.md, "The space page"): /account/space/<id>. It
 * is for the space's users ("Manage Users" on its card): a Team's people, licence number and storage, and who leads
 * its setlists, as sections one under the other. Its data (export, import, resetting from Drive, delete) is
 * "Manage Data", a dialogue on the Account page.
 */
export class SpacePage extends LitElement {
  static override properties = {
    route: { attribute: false },
    _space: { state: true },
    _missing: { state: true },
  }

  declare route: Route | undefined
  declare _space: Space | null
  /** The space is not on this device (a link from another, or one deleted since) */
  declare _missing: boolean

  /** Moves on to another page (a test gives its own) */
  go: (url: string, options?: { fresh?: boolean }) => unknown = goTo

  constructor() {
    super()
    this._space = null
    this._missing = false
  }

  static override styles = [
    panelStyles,
    buttonStyles,
    css`
      :host { display: block; flex: 1; min-height: 0; overflow-y: auto; color: var(--text-color); }
      .content {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        max-width: 800px;
        margin: 0 auto;
      }
      a.back { text-decoration: none; align-self: flex-start; color: inherit; opacity: 0.8; }
      h2 { font-size: var(--font-ui); margin: 0; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
      .label {
        font-size: var(--font-ui-small);
        border: 1px solid var(--border-color, #d5dbdb);
        border-radius: 999px;
        padding: 0.05rem 0.5rem;
        font-weight: normal;
      }
    `,
  ]

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('route')) void this._load()
  }

  get _spaceId(): string | undefined {
    return this.route?.name === 'space' ? this.route.spaceId : undefined
  }

  async _load(): Promise<void> {
    const id = this._spaceId
    const space = id ? await getSpaceById(id) : undefined
    // (a later route may have replaced this one while the space was read)
    if (id !== this._spaceId) return
    this._space = space ?? null
    this._missing = !space
  }

  /** The person left the Team, which is gone from this device */
  _onLeft = (): void => {
    void this.go('/account')
  }

  /** The owner stopped sharing: it is a Personal space again, so read it again (and show it so) */
  _onStopped = (): void => {
    void this._load()
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener(TeamLeftEvent.type, this._onLeft)
    this.addEventListener(TeamSharingStoppedEvent.type, this._onStopped)
  }

  override disconnectedCallback(): void {
    this.removeEventListener(TeamLeftEvent.type, this._onLeft)
    this.removeEventListener(TeamSharingStoppedEvent.type, this._onStopped)
    super.disconnectedCallback()
  }

  override render() {
    const space = this._space
    if (this._missing) {
      return html`<div class="content">
        <a class="back" href="/account">← Account and Teams</a>
        <p role="alert">That space is not on this device.</p>
      </div>`
    }
    if (!space) return nothing
    const kind = spaceKind(space)
    const role = spaceRole(space)
    return html`<div class="content">
      <a class="back" href="/account">← Account and Teams</a>
      <h2>
        ${space.name}
        ${kind ? html`<span class="label">${kind}</span>` : nothing}
        ${role ? html`<span class="label">${role}</span>` : nothing}
      </h2>
      <people-list .space=${space}></people-list>
      ${
        space.team
          ? html`<team-membership-panel .space=${space}></team-membership-panel>
            <team-licence-panel .space=${space}></team-licence-panel>
            <team-storage-panel .space=${space}></team-storage-panel>`
          : nothing
      }
    </div>`
  }
}
customElements.define('space-page', SpacePage)

declare global {
  interface HTMLElementTagNameMap {
    'space-page': SpacePage
  }
}
