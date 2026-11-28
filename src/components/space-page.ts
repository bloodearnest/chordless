import { css, html, LitElement, nothing } from 'lit'
import type { Space } from '../js/data-types.ts'
import type { Route } from '../js/router.ts'
import { getSpaceById } from '../js/space.ts'
import { spaceKind, spaceRole } from '../js/space-label.ts'
import { t } from '../js/text.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'
import './people-list.ts'

/**
 * Everything about one space, on a page of its own (docs/ACCOUNT.md, "The space page"): /account/space/<id>, "Manage
 * Users" on its card. A Personal space's is who leads its setlists. A team's people, roles and licence are its church's,
 * on the church's page, which it links to. Its data (export, import, delete) is "Manage Data", a dialogue on the
 * Account page.
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
      a.btn { text-decoration: none; align-self: flex-start; }
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

  override render() {
    const space = this._space
    if (this._missing) {
      return html`<div class="content">
        <a class="back" href="/account">${t('space-back')}</a>
        <p role="alert">${t('space-page-missing')}</p>
      </div>`
    }
    if (!space) return nothing
    const kind = spaceKind(space)
    const role = spaceRole(space)
    return html`<div class="content">
      <a class="back" href="/account">${t('space-back')}</a>
      <h2>
        ${space.name}
        ${kind ? html`<span class="label">${kind}</span>` : nothing}
        ${role ? html`<span class="label">${role}</span>` : nothing}
      </h2>
      ${
        // (a team's people, roles and licence are its church's, kept on Chordless)
        space.team
          ? html`<p id="church-team">${t('space-page-church')}</p>
              <a class="btn" id="church-link" href="/account/churches">${t('space-page-church-link')}</a>`
          : html`<people-list .space=${space}></people-list>`
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
