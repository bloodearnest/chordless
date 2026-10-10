import { Task } from '@lit/task'
import { css, html, LitElement } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Organisation } from '../js/data-types.ts'
import {
  createOrganisation,
  getCurrentOrganisation,
  listOrganisations,
  switchOrganisation,
} from '../js/organisation.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import './icon.ts'
import { buttonStyles, fieldStyles } from './shared-styles.ts'

/** What the component loads: the organisations, and the name of the current one */
interface OrganisationList {
  organisations: Organisation[]
  current: string
}

/**
 * SelectOrganisation Component
 *
 * Displays current organisation and allows switching between them.
 */
export class SelectOrganisation extends LitElement {
  static override properties = {
    _showCreateForm: { state: true },
    _newOrganisationName: { state: true },
    _creating: { state: true },
    _formError: { state: true }, // why the new organisation wasn't created
  }

  declare _showCreateForm: boolean
  declare _newOrganisationName: string
  declare _creating: boolean
  declare _formError: string

  _switchModal: Ref<AppModal>
  _orgs: Task<[], OrganisationList>

  static override styles = [
    buttonStyles,
    fieldStyles,
    css`
      :host {
        display: block;
      }

      .organisations-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-bottom: 1rem;
      }

      .organisation-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem;
        background: var(--tint-subtle);
        border-radius: 4px;
        transition: background 0.2s;
        cursor: pointer;
      }

      .organisation-item:hover {
        background: var(--tint);
      }

      .organisation-item.current {
        background: color-mix(in srgb, var(--color-primary, #2477ad) 20%, transparent);
        cursor: default;
      }

      .organisation-name {
        font-size: var(--font-ui);
        font-weight: 500;
      }

      .organisation-badge {
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

      .create-form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0.75rem;
        background: var(--tint-subtle);
        border-radius: 4px;
      }

      .form-error {
        margin: 0;
        color: var(--color-danger, #e74c3c);
        font-size: var(--font-ui-small);
      }

      .create-form-buttons {
        display: flex;
        gap: 0.5rem;
      }

      .create-form-buttons .btn {
        flex: 1;
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
    // The organisations, and which is current: loaded when first rendered, and
    // again after one is created
    this._orgs = new Task(this, {
      task: async () => ({
        organisations: await listOrganisations(),
        current: getCurrentOrganisation().name, // synchronous, from localStorage
      }),
      args: () => [],
      onError: error => console.error('Failed to load organisations:', error),
    })
    this._showCreateForm = false
    this._newOrganisationName = ''
    this._creating = false
  }

  async _handleSwitch(org: Organisation): Promise<void> {
    if (org.name === this._orgs.value?.current) {
      return
    }

    const modal = this._switchModal.value
    if (!modal) return
    modal.message = `Switch to "${org.name}"? This reloads the page.`
    if (await modal.ask()) {
      await switchOrganisation(org.id)
    }
  }

  _toggleCreateForm(): void {
    this._showCreateForm = !this._showCreateForm
    this._newOrganisationName = ''
    this._formError = ''
  }

  _handleNameInput(e: Event): void {
    this._newOrganisationName = (e.target as HTMLInputElement).value
  }

  async _handleCreate(e: Event): Promise<void> {
    e.preventDefault()

    const name = this._newOrganisationName.trim()
    if (!name) {
      this._formError = 'Please enter an organisation name'
      return
    }
    if (this._orgs.value?.organisations.some(org => org.name === name)) {
      this._formError = 'An organisation with this name already exists'
      return
    }

    this._creating = true
    this._formError = ''

    try {
      await createOrganisation(name)
      // The new organisation shows in the list
      await this._orgs.run()

      // Hide form
      this._showCreateForm = false
      this._newOrganisationName = ''
    } catch (error) {
      console.error('Failed to create organisation:', error)
      this._formError = `Failed to create organisation: ${error instanceof Error ? error.message : error}`
    } finally {
      this._creating = false
    }
  }

  override render() {
    const loading = () => html`<div class="loading">Loading organisations...</div>`
    return this._orgs.render({
      initial: loading,
      pending: loading,
      complete: ({ organisations, current }) => this._renderOrganisations(organisations, current),
      error: error =>
        html`<p class="form-error" role="alert">Couldn't load organisations: ${error instanceof Error ? error.message : error}</p>`,
    })
  }

  _renderOrganisations(organisations: Organisation[], current: string) {
    if (organisations.length === 0) {
      return html`
        <div class="empty-state">
          <p>No organisations found. Create your first organisation to get started.</p>
        </div>
      `
    }

    return html`
      <div class="organisation-selector">
        <div class="organisations-list">
          ${organisations.map(
            org => html`
              <div
                class="organisation-item ${org.name === current ? 'current' : ''}"
                @click=${() => this._handleSwitch(org)}
              >
                <span class="organisation-name">${org.name}</span>
                ${
                  org.name === current
                    ? html`<span class="organisation-badge">CURRENT</span>`
                    : html`<button
                      class="btn primary switch-button"
                      @click=${(e: Event) => {
                        e.stopPropagation()
                        this._handleSwitch(org)
                      }}
                    >
                      Switch
                    </button>`
                }
              </div>
            `
          )}
        </div>

        ${
          this._showCreateForm
            ? html`
              <form class="create-form" @submit=${this._handleCreate}>
                <input
                  class="field"
                  type="text"
                  placeholder="New organisation name..."
                  .value=${this._newOrganisationName}
                  @input=${this._handleNameInput}
                  ?disabled=${this._creating}
                  required
                />
                ${
                  this._formError
                    ? html`<p class="form-error" role="alert">${this._formError}</p>`
                    : ''
                }
                <div class="create-form-buttons">
                  <button
                    type="button"
                    class="btn"
                    @click=${this._toggleCreateForm}
                    ?disabled=${this._creating}
                  >
                    Cancel
                  </button>
                  <button type="submit" class="btn primary" ?disabled=${this._creating}>
                    ${this._creating ? 'Creating...' : 'Create Organisation'}
                  </button>
                </div>
              </form>
            `
            : html`
              <button class="btn block success" @click=${this._toggleCreateForm}>
                <app-icon name="add" size="20"></app-icon>
                Create New Organisation
              </button>
            `
        }
        <app-modal
          id="switch-modal"
          ${ref(this._switchModal)}
          type="confirm"
          size="small"
          heading="Switch organisation?"
          confirm-label="Switch"
        ></app-modal>
      </div>
    `
  }
}

customElements.define('select-organisation', SelectOrganisation)

declare global {
  interface HTMLElementTagNameMap {
    'select-organisation': SelectOrganisation
  }
}
