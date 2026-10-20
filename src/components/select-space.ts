import { Task } from '@lit/task'
import { css, html, LitElement } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Space } from '../js/data-types.ts'
import { getCurrentSpace, listSpaces, switchSpace } from '../js/space.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import './icon.ts'
import { buttonStyles } from './shared-styles.ts'

/** What the component loads: the spaces, and the name of the current one */
interface SpaceList {
  spaces: Space[]
  current: string
}

/**
 * SelectSpace Component
 *
 * Shows the spaces on this device and the current one, and switches between them. It does not
 * make one: a space is made for a team (docs/SPACES.md), which comes with its folder and members.
 */
export class SelectSpace extends LitElement {
  /** Makes another space the current one, and starts the app afresh (a test gives its own) */
  switchTo: (spaceId: string) => Promise<void> = switchSpace

  _switchModal: Ref<AppModal>
  _spaces: Task<[], SpaceList>

  static override styles = [
    buttonStyles,
    css`
      :host {
        display: block;
      }

      .spaces-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-bottom: 1rem;
      }

      .space-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem;
        background: var(--tint-subtle);
        border-radius: 4px;
        transition: background 0.2s;
        cursor: pointer;
      }

      .space-item:hover {
        background: var(--tint);
      }

      .space-item.current {
        background: color-mix(in srgb, var(--color-primary, #2477ad) 20%, transparent);
        cursor: default;
      }

      .space-name {
        font-size: var(--font-ui);
        font-weight: 500;
      }

      .space-badge {
        padding: 0.3rem 0.8rem;
        background: var(--color-primary, #2477ad);
        color: var(--button-text, white);
        border-radius: 4px;
        font-size: var(--font-ui-small);
        font-weight: 600;
      }

      .switch-button {
        padding: 0.5rem 1rem;
      }

      .form-error {
        margin: 0;
        color: var(--color-danger, #e74c3c);
        font-size: var(--font-ui-small);
      }

      .loading,
      .empty-state {
        text-align: center;
        opacity: 0.7;
      }

      .empty-state p {
        margin: 0;
      }
    `,
  ]

  constructor() {
    super()
    this._switchModal = createRef()
    // The spaces, and which is current: loaded when first rendered
    this._spaces = new Task(this, {
      task: async () => ({
        spaces: await listSpaces(),
        current: getCurrentSpace().name, // synchronous, from localStorage
      }),
      args: () => [],
      onError: error => console.error('Failed to load spaces:', error),
    })
  }

  /** Read the spaces again (one was deleted elsewhere on the page) */
  refresh(): void {
    this._spaces.run()
  }

  async _handleSwitch(space: Space): Promise<void> {
    if (space.name === this._spaces.value?.current) {
      return
    }

    const modal = this._switchModal.value
    if (!modal) return
    modal.message = `Switch to "${space.name}"? This reloads the page.`
    if (await modal.ask()) {
      await this.switchTo(space.id)
    }
  }

  override render() {
    const loading = () => html`<div class="loading">Loading spaces...</div>`
    return this._spaces.render({
      initial: loading,
      pending: loading,
      complete: ({ spaces, current }) => this._renderSpaces(spaces, current),
      error: error =>
        html`<p class="form-error" role="alert">Couldn't load spaces: ${error instanceof Error ? error.message : error}</p>`,
    })
  }

  _renderSpaces(spaces: Space[], current: string) {
    return html`
      <div class="space-selector">
        ${
          spaces.length === 0
            ? html`<div class="empty-state">
                <p>No spaces found.</p>
              </div>`
            : ''
        }
        <div class="spaces-list">
          ${spaces.map(
            space => html`
              <div
                class="space-item ${space.name === current ? 'current' : ''}"
                @click=${() => this._handleSwitch(space)}
              >
                <span class="space-name">${space.name}</span>
                ${
                  space.name === current
                    ? html`<span class="space-badge">CURRENT</span>`
                    : html`<button
                      class="btn primary switch-button"
                      @click=${(e: Event) => {
                        e.stopPropagation()
                        this._handleSwitch(space)
                      }}
                    >
                      Switch
                    </button>`
                }
              </div>
            `
          )}
        </div>

        <app-modal
          id="switch-modal"
          ${ref(this._switchModal)}
          type="confirm"
          size="small"
          heading="Switch space?"
          confirm-label="Switch"
        ></app-modal>
      </div>
    `
  }
}

customElements.define('select-space', SelectSpace)

declare global {
  interface HTMLElementTagNameMap {
    'select-space': SelectSpace
  }
}
