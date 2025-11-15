import { LitElement, html, css } from 'lit';
import {
  getCurrentOrganisation,
  setCurrentOrganisation,
  listOrganisations,
} from '../js/workspace.js';
import { SetalightDB } from '../js/db.js';

/**
 * SelectOrganisation Component
 *
 * Displays current church/organisation and allows switching between them.
 * Uses "organisation" internally but displays "Church" to users.
 */
export class SelectOrganisation extends LitElement {
  static properties = {
    _currentOrganisation: { type: String, state: true },
    _organisations: { type: Array, state: true },
    _loading: { type: Boolean, state: true },
    _showCreateForm: { type: Boolean, state: true },
    _newChurchName: { type: String, state: true },
    _creating: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: block;
    }

    .organisation-selector {
      background: var(--settings-bg, #34495e);
      border-radius: 8px;
      padding: 1.5rem;
      color: var(--settings-text, white);
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
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
      transition: all 0.2s;
      cursor: pointer;
    }

    .organisation-item:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    .organisation-item.current {
      background: rgba(52, 152, 219, 0.2);
      cursor: default;
    }

    .organisation-name {
      font-size: 1rem;
      font-weight: 500;
    }

    .organisation-badge {
      padding: 0.3rem 0.8rem;
      background: #3498db;
      color: white;
      border-radius: 4px;
      font-size: 0.85rem;
      font-weight: 600;
    }

    .switch-button {
      padding: 0.5rem 1rem;
      background: #3498db;
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }

    .switch-button:hover {
      background: #2980b9;
    }

    .switch-button:active {
      transform: scale(0.98);
    }

    .create-button {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem;
      background: rgba(39, 174, 96, 0.2);
      border: none;
      color: white;
      border-radius: 4px;
      font-size: 1rem;
      font-weight: 600;
      transition: all 0.2s;
      justify-content: center;
      cursor: pointer;
      width: 100%;
    }

    .create-button:hover {
      background: rgba(39, 174, 96, 0.3);
    }

    .create-form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 0.75rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
    }

    .create-form input {
      padding: 0.75rem;
      font-size: 1rem;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      color: white;
    }

    .create-form input::placeholder {
      color: rgba(255, 255, 255, 0.5);
    }

    .create-form input:focus {
      outline: none;
      border-color: #27ae60;
      background: rgba(0, 0, 0, 0.4);
    }

    .create-form-buttons {
      display: flex;
      gap: 0.5rem;
    }

    .create-form-buttons button {
      flex: 1;
      padding: 0.75rem;
      font-size: 1rem;
      font-weight: 600;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .create-form-buttons .submit {
      background: #27ae60;
      color: white;
    }

    .create-form-buttons .submit:hover {
      background: #229954;
    }

    .create-form-buttons .cancel {
      background: rgba(0, 0, 0, 0.3);
      color: rgba(255, 255, 255, 0.7);
    }

    .create-form-buttons .cancel:hover {
      background: rgba(0, 0, 0, 0.4);
    }

    .loading {
      background: var(--settings-bg, #34495e);
      border-radius: 8px;
      padding: 1.5rem;
      color: var(--settings-text, white);
      text-align: center;
      opacity: 0.7;
    }

    .empty-state {
      background: var(--settings-bg, #34495e);
      border-radius: 8px;
      padding: 1.5rem;
      color: var(--settings-text, white);
      text-align: center;
    }

    .empty-state p {
      opacity: 0.7;
      margin: 0;
    }
  `;

  constructor() {
    super();
    this._currentOrganisation = getCurrentOrganisation();
    this._organisations = [];
    this._loading = true;
    this._showCreateForm = false;
    this._newChurchName = '';
    this._creating = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadOrganisations();
  }

  async _loadOrganisations() {
    this._loading = true;
    try {
      this._organisations = await listOrganisations();
      this._currentOrganisation = getCurrentOrganisation();
    } catch (error) {
      console.error('Failed to load organisations:', error);
    } finally {
      this._loading = false;
    }
  }

  async _handleSwitch(organisationName) {
    if (organisationName === this._currentOrganisation) {
      return;
    }

    const confirmed = confirm(
      `Switch to church "${organisationName}"?\n\nThis will reload the page.`
    );

    if (confirmed) {
      setCurrentOrganisation(organisationName);
      window.location.reload();
    }
  }

  _toggleCreateForm() {
    this._showCreateForm = !this._showCreateForm;
    this._newChurchName = '';
  }

  _handleNameInput(e) {
    this._newChurchName = e.target.value;
  }

  async _handleCreate(e) {
    e.preventDefault();

    const name = this._newChurchName.trim();
    if (!name) {
      alert('Please enter a church name');
      return;
    }

    // Check if already exists
    if (this._organisations.includes(name)) {
      alert('A church with this name already exists');
      return;
    }

    this._creating = true;

    try {
      // Create by initializing a new database
      const db = new SetalightDB(name);
      await db.init();

      alert(`✅ Church "${name}" created!`);

      // Reload organisations list
      await this._loadOrganisations();

      // Hide form
      this._showCreateForm = false;
      this._newChurchName = '';
    } catch (error) {
      console.error('Failed to create church:', error);
      alert(`❌ Failed to create church: ${error.message}`);
    } finally {
      this._creating = false;
    }
  }

  render() {
    if (this._loading) {
      return html`<div class="loading">Loading churches...</div>`;
    }

    if (this._organisations.length === 0) {
      return html`
        <div class="empty-state">
          <p>No churches found. Create your first church to get started.</p>
        </div>
      `;
    }

    return html`
      <div class="organisation-selector">
        <div class="organisations-list">
          ${this._organisations.map(
            org => html`
              <div
                class="organisation-item ${org === this._currentOrganisation ? 'current' : ''}"
                @click=${() => this._handleSwitch(org)}
              >
                <span class="organisation-name">${org}</span>
                ${org === this._currentOrganisation
                  ? html`<span class="organisation-badge">CURRENT</span>`
                  : html`<button
                      class="switch-button"
                      @click=${e => {
                        e.stopPropagation();
                        this._handleSwitch(org);
                      }}
                    >
                      Switch
                    </button>`}
              </div>
            `
          )}
        </div>

        ${this._showCreateForm
          ? html`
              <form class="create-form" @submit=${this._handleCreate}>
                <input
                  type="text"
                  placeholder="New church name..."
                  .value=${this._newChurchName}
                  @input=${this._handleNameInput}
                  ?disabled=${this._creating}
                  required
                />
                <div class="create-form-buttons">
                  <button
                    type="button"
                    class="cancel"
                    @click=${this._toggleCreateForm}
                    ?disabled=${this._creating}
                  >
                    Cancel
                  </button>
                  <button type="submit" class="submit" ?disabled=${this._creating}>
                    ${this._creating ? 'Creating...' : 'Create Church'}
                  </button>
                </div>
              </form>
            `
          : html`
              <button class="create-button" @click=${this._toggleCreateForm}>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Create New Church
              </button>
            `}
      </div>
    `;
  }
}

customElements.define('select-organisation', SelectOrganisation);
