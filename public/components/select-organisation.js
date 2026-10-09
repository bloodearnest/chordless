import { css, html, LitElement } from 'lit'
import { createRef, ref } from 'lit/directives/ref.js'
import {
  createOrganisation,
  getCurrentOrganisation,
  listOrganisations,
  switchOrganisation,
} from '../js/organisation.js'
import './app-modal.js'
import './icon.js'
import { buttonStyles, fieldStyles } from './shared-styles.js'

/**
 * SelectOrganisation Component
 *
 * Displays current organisation and allows switching between them.
 */
export class SelectOrganisation extends LitElement {
  static properties = {
    _currentOrganisation: { state: true },
    _organisations: { state: true },
    _loading: { state: true },
    _showCreateForm: { state: true },
    _newOrganisationName: { state: true },
    _creating: { state: true },
    _formError: { state: true }, // why the new organisation wasn't created
  }

  static styles = [
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
        background: color-mix(in srgb, var(--color-primary, #3498db) 20%, transparent);
        cursor: default;
      }

      .organisation-name {
        font-size: var(--font-ui);
        font-weight: 500;
      }

      .organisation-badge {
        padding: 0.3rem 0.8rem;
        background: var(--color-primary, #3498db);
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
    this._currentOrganisation = null
    this._organisations = []
    this._loading = true
    this._showCreateForm = false
    this._newOrganisationName = ''
    this._creating = false
  }

  connectedCallback() {
    super.connectedCallback()
    this._loadOrganisations()
  }

  async _loadOrganisations() {
    this._loading = true
    try {
      this._organisations = await listOrganisations()
      const { name } = getCurrentOrganisation() // Synchronous - reads from cache
      this._currentOrganisation = name
    } catch (error) {
      console.error('Failed to load organisations:', error)
    } finally {
      this._loading = false
    }
  }

  async _handleSwitch(org) {
    if (org.name === this._currentOrganisation) {
      return
    }

    const modal = this._switchModal.value
    modal.message = `Switch to "${org.name}"? This reloads the page.`
    if (await modal.ask()) {
      await switchOrganisation(org.id)
    }
  }

  _toggleCreateForm() {
    this._showCreateForm = !this._showCreateForm
    this._newOrganisationName = ''
    this._formError = ''
  }

  _handleNameInput(e) {
    this._newOrganisationName = e.target.value
  }

  async _handleCreate(e) {
    e.preventDefault()

    const name = this._newOrganisationName.trim()
    if (!name) {
      this._formError = 'Please enter an organisation name'
      return
    }
    if (this._organisations.some(org => org.name === name)) {
      this._formError = 'An organisation with this name already exists'
      return
    }

    this._creating = true
    this._formError = ''

    try {
      await createOrganisation(name)
      // The new organisation shows in the list
      await this._loadOrganisations()

      // Hide form
      this._showCreateForm = false
      this._newOrganisationName = ''
    } catch (error) {
      console.error('Failed to create organisation:', error)
      this._formError = `Failed to create organisation: ${error.message}`
    } finally {
      this._creating = false
    }
  }

  render() {
    if (this._loading) {
      return html`<div class="loading">Loading organisations...</div>`
    }

    if (this._organisations.length === 0) {
      return html`
        <div class="empty-state">
          <p>No organisations found. Create your first organisation to get started.</p>
        </div>
      `
    }

    return html`
      <div class="organisation-selector">
        <div class="organisations-list">
          ${this._organisations.map(
            org => html`
              <div
                class="organisation-item ${org.name === this._currentOrganisation ? 'current' : ''}"
                @click=${() => this._handleSwitch(org)}
              >
                <span class="organisation-name">${org.name}</span>
                ${
                  org.name === this._currentOrganisation
                    ? html`<span class="organisation-badge">CURRENT</span>`
                    : html`<button
                      class="btn primary switch-button"
                      @click=${e => {
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
