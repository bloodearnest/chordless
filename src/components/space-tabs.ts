import { css, html, LitElement, nothing } from 'lit'
import type { Space } from '../js/data-types.ts'
import { goTo } from '../js/navigation.ts'
import { SHARED_DB_ID } from '../js/share-receiver.ts'
import { getCurrentSpace, switchSpace } from '../js/space.ts'
import { loadSpaceTabs, noteTabUsed, type SpaceTab, splitTabs } from '../js/space-tabs.ts'

/**
 * The places the person's songs and setlists are kept, as tabs under the header (docs/SPACES.md,
 * "Space tabs, and joining by invite"): each Team and Personal by name with a small label, and
 * Shared. Nothing is drawn when there is one place or none, so a person with a single space never
 * sees it. A tab is the space switch, which shows the home page afresh in that space; the Shared tab
 * opens the home page showing what was shared.
 *
 * Usage:
 *   <space-tabs></space-tabs>              the current space's tab is marked
 *   <space-tabs shared></space-tabs>       the Shared tab is marked (the page shows what was shared)
 */
export class SpaceTabs extends LitElement {
  static override properties = {
    shared: { type: Boolean },
    spaces: { attribute: false },
    _tabs: { state: true },
    _currentId: { state: true },
  }

  /** Whether the page shows what was shared by link, in place of the current space */
  declare shared: boolean
  /** The spaces to make tabs of (all of this device's; a test gives its own) */
  declare spaces: Space[] | undefined
  declare _tabs: SpaceTab[]
  declare _currentId: string | null

  /** Switches space (a test gives its own) */
  switchTo: (spaceId: string) => Promise<void> = spaceId => switchSpace(spaceId)
  /** Opens the page of what was shared (a test gives its own) */
  openShared: () => void = () => void goTo('/?shared', { fresh: true })

  static override styles = css`
    :host {
      display: block;
      background: var(--bg-secondary, #f8f9fa);
      border-bottom: 1px solid var(--border-light, #ccc);
      font-size: var(--font-ui-small, 0.85rem);
    }
    [role='tablist'] {
      display: flex;
      align-items: flex-end;
      gap: 0.25rem;
      padding: 0 0.5rem;
      overflow: hidden;
    }
    [role='tab'], select {
      flex: 0 1 auto;
      min-width: 0;
      padding: 0.5rem 0.75rem;
      font: inherit;
      font-weight: 600;
      color: var(--text-secondary, #666);
      background: transparent;
      border: 2px solid transparent;
      border-bottom: none;
      border-radius: 6px 6px 0 0;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    [role='tab'][aria-selected='true'] {
      color: var(--text-color, #222);
      background: var(--bg-color, #fff);
      border-color: var(--border-light, #ccc);
      margin-bottom: -1px;
      padding-bottom: calc(0.5rem + 1px);
    }
    .kind {
      margin-left: 0.35rem;
      font-size: 0.75em;
      font-weight: 400;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
  `

  constructor() {
    super()
    this.shared = false
    this.spaces = undefined
    this._tabs = []
    this._currentId = null
  }

  override connectedCallback(): void {
    super.connectedCallback()
    void this.load()
  }

  /** Read which places there are (again, when something may have changed) */
  async load(): Promise<void> {
    this._currentId = this.shared ? SHARED_DB_ID : getCurrentSpace().id
    try {
      this._tabs = await loadSpaceTabs(getCurrentSpace().id, this.spaces)
    } catch (error) {
      // The page works without its tabs
      console.error('[SpaceTabs] Could not read the spaces:', error)
      this._tabs = []
    }
  }

  override render() {
    if (this._tabs.length < 2) return nothing
    const { shown, more } = splitTabs(this._tabs, this._currentId)
    return html`
      <div role="tablist" aria-label="Where songs and setlists are kept" @keydown=${this._keydown}>
        ${shown.map(tab => this._renderTab(tab))}
        ${
          more.length
            ? html`<select aria-label="More" @change=${this._chooseMore}>
                <option value="" selected>More</option>
                ${more.map(tab => html`<option value=${tab.id}>${tab.name}${tab.kind ? ` (${tab.kind})` : ''}</option>`)}
              </select>`
            : nothing
        }
      </div>
    `
  }

  _renderTab(tab: SpaceTab) {
    const selected = tab.id === this._currentId
    return html`
      <button
        role="tab"
        data-space=${tab.id}
        aria-selected=${selected}
        tabindex=${selected ? 0 : -1}
        @click=${() => this._open(tab)}
      >
        ${tab.name}${tab.kind ? html`<span class="kind">${tab.kind}</span>` : nothing}
      </button>
    `
  }

  _chooseMore(event: Event): void {
    const id = (event.target as HTMLSelectElement).value
    const tab = this._tabs.find(other => other.id === id)
    if (tab) void this._open(tab)
  }

  async _open(tab: SpaceTab): Promise<void> {
    if (tab.id === this._currentId) return
    noteTabUsed(tab.id)
    if (tab.id === SHARED_DB_ID) this.openShared()
    else await this.switchTo(tab.id)
  }

  /** Arrow keys move between the tabs (Enter or a tap opens it) */
  _keydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const tabs = [...this.renderRoot.querySelectorAll<HTMLElement>('[role="tab"]')]
    const at = tabs.findIndex(tab => tab === (event.target as Node))
    if (at === -1) return
    const next = tabs[(at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
    event.preventDefault()
    next.focus()
  }
}
customElements.define('space-tabs', SpaceTabs)

declare global {
  interface HTMLElementTagNameMap {
    'space-tabs': SpaceTabs
  }
}
