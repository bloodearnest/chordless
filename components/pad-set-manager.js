import { LitElement, html, css } from 'lit';
import {
  listPadSets,
  uploadPadSet,
  derivePadSetName,
  getActivePadSet,
  selectPadSet,
} from '../js/pad-set-service.js';

export class PadSetManager extends LitElement {
  static properties = {
    padSets: { type: Array, state: true },
    uploading: { type: Boolean, state: true },
    error: { type: String, state: true },
    successMessage: { type: String, state: true },
    padSetName: { type: String, state: true },
    fileName: { type: String, state: true },
    loading: { type: Boolean, state: true },
    selectedPadSetId: { type: String, state: true },
    selectPadSetMessage: { type: String, state: true },
    selectPadSetError: { type: String, state: true },
  };

  static styles = css`
    :host {
      display: block;
    }

    .padset-card {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1rem;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      margin-bottom: 0.75rem;
      position: relative;
    }

    .padset-card input[type='radio'] {
      margin-right: 0.5rem;
    }

    .padset-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .padset-card:last-child {
      margin-bottom: 0;
    }

    .padset-name {
      font-weight: 600;
      font-size: 1rem;
    }

    .padset-meta {
      font-size: 0.85rem;
      opacity: 0.7;
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-top: 1rem;
    }

    label {
      font-size: 0.9rem;
      font-weight: 500;
    }

    input[type='text'],
    input[type='file'] {
      width: 100%;
      padding: 0.6rem 0.75rem;
      border-radius: 4px;
      border: none;
      font-size: 1rem;
    }

    input[type='file'] {
      background: rgba(255, 255, 255, 0.08);
      color: inherit;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }

    button {
      border: none;
      border-radius: 4px;
      padding: 0.6rem 1rem;
      font-weight: 600;
      cursor: pointer;
    }

    button primary {
      background: var(--header-bg, #3498db);
      color: white;
    }

    .upload-button {
      background: var(--header-bg, #3498db);
      color: white;
    }

    .upload-button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .status-message {
      font-size: 0.85rem;
      padding: 0.4rem 0.5rem;
      border-radius: 4px;
    }

    .status-message.error {
      background: rgba(231, 76, 60, 0.2);
      border: 1px solid rgba(231, 76, 60, 0.4);
    }

    .status-message.success {
      background: rgba(39, 174, 96, 0.2);
      border: 1px solid rgba(39, 174, 96, 0.4);
    }

    .empty-state {
      font-size: 0.9rem;
      opacity: 0.75;
      margin-bottom: 0.5rem;
    }

    .padset-message {
      font-size: 0.85rem;
      opacity: 0.85;
    }
  `;

  constructor() {
    super();
    this.padSets = [];
    this.uploading = false;
    this.error = '';
    this.successMessage = '';
    this.padSetName = '';
    this.fileName = '';
    this.loading = true;
    this._selectedFile = null;
    this.selectedPadSetId = getActivePadSet().id;
    this.selectPadSetMessage = '';
    this.selectPadSetError = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadPadSets();
    this._boundListUpdated = () => this._loadPadSets(true);
    window.addEventListener('pad-set-list-updated', this._boundListUpdated);
    this._boundPadSetChanged = event => {
      const padSet = event.detail?.padSet;
      if (padSet) {
        this.selectedPadSetId = padSet.id;
      } else {
        this.selectedPadSetId = getActivePadSet().id;
      }
    };
    window.addEventListener('pad-set-changed', this._boundPadSetChanged);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('pad-set-list-updated', this._boundListUpdated);
    window.removeEventListener('pad-set-changed', this._boundPadSetChanged);
  }

  async _loadPadSets(force = false) {
    this.loading = true;
    try {
      this.padSets = await listPadSets(force);
    } catch (error) {
      console.error('[PadSetManager] Failed to load pad sets:', error);
      this.error = error.message || 'Unable to load pad sets.';
    } finally {
      this.loading = false;
    }
  }

  _handleFileChange(event) {
    const file = event.target.files?.[0] || null;
    this._selectedFile = file;
    if (file) {
      this.fileName = file.name;
      if (!this.padSetName || this.padSetName === 'New Pad Set') {
        this.padSetName = derivePadSetName(file.name);
      }
    } else {
      this.fileName = '';
    }
  }

  _handleNameInput(event) {
    const input = event.target;
    const raw = input.value;
    const sanitized = raw.replace(/[^a-zA-Z0-9\s-]+/g, '');
    if (sanitized !== raw) {
      const pos = input.selectionStart - (raw.length - sanitized.length);
      input.value = sanitized;
      input.setSelectionRange(Math.max(0, pos), Math.max(0, pos));
    }
    this.padSetName = sanitized;
  }

  async _handleUpload(event) {
    event.preventDefault();
    this.error = '';
    this.successMessage = '';

    if (!this._selectedFile) {
      this.error = 'Please select a ZIP file to upload.';
      return;
    }

    this.uploading = true;
    try {
      await uploadPadSet(this._selectedFile, this.padSetName);
      this.successMessage = 'Pad set uploaded successfully.';
      this._selectedFile = null;
      this.padSetName = '';
      this.fileName = '';
      this.shadowRoot.getElementById('padset-file-input').value = '';
      await this._loadPadSets(true);
    } catch (error) {
      console.error('[PadSetManager] Upload failed:', error);
      this.error = error.message || 'Failed to upload pad set.';
    } finally {
      this.uploading = false;
    }
  }

  async _handleDefaultPadSetChange(newIdOrEvent) {
    const newId = typeof newIdOrEvent === 'string' ? newIdOrEvent : newIdOrEvent.target.value;
    const fallbackTarget = typeof newIdOrEvent !== 'string' ? newIdOrEvent.target : null;
    const previousId = this.selectedPadSetId;
    this.selectedPadSetId = newId;
    this.selectPadSetMessage = '';
    this.selectPadSetError = '';

    try {
      await selectPadSet(newId);
      this.selectPadSetMessage = 'Default pad set updated.';
    } catch (error) {
      console.error('[PadSetManager] Failed to set default pad set:', error);
      this.selectedPadSetId = previousId;
      if (fallbackTarget) {
        fallbackTarget.value = previousId;
      }
      this.selectPadSetError = error.message || 'Unable to set pad set.';
    }
  }

  renderPadSetList() {
    if (this.loading) {
      return html`<div class="empty-state">Loading pad sets…</div>`;
    }

    if (!this.padSets || this.padSets.length === 0) {
      return html`<div class="empty-state">No pad sets available yet.</div>`;
    }

    return this.padSets.map(
      set => html`
        <div class="padset-card">
          <label class="padset-header">
            <input
              type="radio"
              name="padset-selection"
              .value=${set.id}
              ?checked=${this.selectedPadSetId === set.id}
              @change=${e => this._handleDefaultPadSetChange(e)}
            />
            <div>
              <div class="padset-name">${set.name}</div>
              <div class="padset-meta">
                ${set.type === 'builtin' ? 'Built-in' : 'Custom Drive Pad Set'}
                ${set.modifiedTime
                  ? html` • Updated ${new Date(set.modifiedTime).toLocaleString()}`
                  : ''}
              </div>
            </div>
          </label>
        </div>
      `
    );
  }

  render() {
    return html`
      ${this.renderPadSetList()}
      ${this.selectPadSetMessage
        ? html`<div class="padset-message" style="color: #8fd18f;">
            ${this.selectPadSetMessage}
          </div>`
        : ''}
      ${this.selectPadSetError
        ? html`<div class="padset-message" style="color: #ffb3b3;">${this.selectPadSetError}</div>`
        : ''}

      <form @submit=${this._handleUpload}>
        <div>
          <label for="padset-name">Pad Set Name</label>
          <input
            id="padset-name"
            type="text"
            .value=${this.padSetName}
            @input=${this._handleNameInput}
            placeholder="e.g. Warm Pads - Churchfront"
          />
        </div>

        <div>
          <label for="padset-file-input">Pad Set ZIP File</label>
          <input
            id="padset-file-input"
            type="file"
            accept=".zip"
            @change=${this._handleFileChange}
            ?disabled=${this.uploading}
          />
          ${this.fileName ? html`<div class="padset-meta">Selected: ${this.fileName}</div>` : ''}
        </div>

        ${this.error ? html`<div class="status-message error">${this.error}</div>` : ''}
        ${this.successMessage
          ? html`<div class="status-message success">${this.successMessage}</div>`
          : ''}

        <div class="actions">
          <button
            type="submit"
            class="upload-button"
            ?disabled=${this.uploading || !this._selectedFile}
          >
            ${this.uploading ? 'Uploading…' : 'Upload Pad Set'}
          </button>
        </div>
      </form>
    `;
  }
}

customElements.define('pad-set-manager', PadSetManager);
