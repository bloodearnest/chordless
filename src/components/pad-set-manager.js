import { css, html, LitElement } from 'lit'
import { createRef, ref } from 'lit/directives/ref.js'
import { derivePadSetName, uploadPadSet } from '../js/pad-set-service.ts'
import { PadSetsController } from '../js/pad-sets-controller.ts'
import { buttonStyles, fieldStyles } from './shared-styles.ts'

export class PadSetManager extends LitElement {
  static properties = {
    _uploading: { state: true },
    _error: { state: true },
    _successMessage: { state: true },
    _padSetName: { state: true },
    _fileName: { state: true },
    _selectPadSetMessage: { state: true },
    _selectPadSetError: { state: true },
  }

  static styles = [
    buttonStyles,
    fieldStyles,
    css`
      :host {
        display: block;
      }

      .padset-card {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 1rem;
        background: var(--tint);
        border-radius: 8px;
        margin-bottom: 0.75rem;
        position: relative;
      }

      .padset-card:last-child {
        margin-bottom: 0;
      }

      .padset-card input[type='radio'] {
        margin-right: 0.5rem;
      }

      .padset-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .padset-name {
        font-weight: 600;
        font-size: var(--font-ui);
      }

      .padset-meta {
        font-size: var(--font-ui-small);
        opacity: 0.7;
      }

      form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-top: 1rem;
      }

      label {
        font-size: var(--font-ui);
        font-weight: 500;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }

      .status-message {
        font-size: var(--font-ui-small);
        padding: 0.4rem 0.5rem;
        border-radius: 4px;
      }

      .status-message.error {
        background: color-mix(in srgb, var(--color-danger, #e74c3c) 15%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-danger, #e74c3c) 40%, transparent);
      }

      .status-message.success {
        background: color-mix(in srgb, var(--color-success, #27ae60) 15%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success, #27ae60) 40%, transparent);
      }

      .empty-state {
        font-size: var(--font-ui);
        opacity: 0.75;
        margin-bottom: 0.5rem;
      }

      .padset-message {
        font-size: var(--font-ui-small);
        opacity: 0.85;
      }

      .padset-message.success {
        color: var(--color-success, #27ae60);
      }

      .padset-message.error {
        color: var(--color-danger, #e74c3c);
      }
    `,
  ]

  constructor() {
    super()
    this._fileInput = createRef()
    this._padSets = new PadSetsController(this)
    this._uploading = false
    this._error = ''
    this._successMessage = ''
    this._padSetName = ''
    this._fileName = ''
    this._selectedFile = null
    this._selectPadSetMessage = ''
    this._selectPadSetError = ''
  }

  _handleFileChange(event) {
    const file = event.target.files?.[0] || null
    this._selectedFile = file
    if (file) {
      this._fileName = file.name
      if (!this._padSetName || this._padSetName === 'New Pad Set') {
        this._padSetName = derivePadSetName(file.name)
      }
    } else {
      this._fileName = ''
    }
  }

  _handleNameInput(event) {
    const input = event.target
    const raw = input.value
    const sanitized = raw.replace(/[^a-zA-Z0-9\s-]+/g, '')
    if (sanitized !== raw) {
      const pos = input.selectionStart - (raw.length - sanitized.length)
      input.value = sanitized
      input.setSelectionRange(Math.max(0, pos), Math.max(0, pos))
    }
    this._padSetName = sanitized
  }

  async _handleUpload(event) {
    event.preventDefault()
    this._error = ''
    this._successMessage = ''

    if (!this._selectedFile) {
      this._error = 'Please select a ZIP file to upload.'
      return
    }

    this._uploading = true
    try {
      await uploadPadSet(this._selectedFile, this._padSetName)
      this._successMessage = 'Pad set uploaded successfully.'
      this._selectedFile = null
      this._padSetName = ''
      this._fileName = ''
      this._fileInput.value.value = ''
      await this._padSets.load(true)
    } catch (error) {
      console.error('[PadSetManager] Upload failed:', error)
      this._error = error.message || 'Failed to upload pad set.'
    } finally {
      this._uploading = false
    }
  }

  async _handleDefaultPadSetChange(event) {
    this._selectPadSetMessage = ''
    this._selectPadSetError = ''
    try {
      await this._padSets.select(event.target.value)
      this._selectPadSetMessage = 'Default pad set updated.'
    } catch (error) {
      console.error('[PadSetManager] Failed to set default pad set:', error)
      this._selectPadSetError = error.message || 'Unable to set pad set.'
    }
  }

  _renderPadSetList() {
    if (this._padSets.loading) {
      return html`<div class="empty-state">Loading pad sets…</div>`
    }

    if (this._padSets.error) {
      return html`<div class="status-message error">${this._padSets.error}</div>`
    }

    if (this._padSets.list.length === 0) {
      return html`<div class="empty-state">No pad sets available yet.</div>`
    }

    return this._padSets.list.map(
      set => html`
        <div class="padset-card">
          <label class="padset-header">
            <input
              type="radio"
              name="padset-selection"
              .value=${set.id}
              .checked=${this._padSets.activeId === set.id}
              @change=${e => this._handleDefaultPadSetChange(e)}
            />
            <div>
              <div class="padset-name">${set.name}</div>
              <div class="padset-meta">
                ${set.type === 'builtin' ? 'Built-in' : 'Custom Drive Pad Set'}
                ${
                  set.modifiedTime
                    ? html` • Updated ${new Date(set.modifiedTime).toLocaleString()}`
                    : ''
                }
              </div>
            </div>
          </label>
        </div>
      `
    )
  }

  render() {
    return html`
      ${this._renderPadSetList()}
      ${
        this._selectPadSetMessage
          ? html`<div class="padset-message success">
            ${this._selectPadSetMessage}
          </div>`
          : ''
      }
      ${
        this._selectPadSetError
          ? html`<div class="padset-message error">${this._selectPadSetError}</div>`
          : ''
      }

      <form @submit=${this._handleUpload}>
        <div>
          <label for="padset-name">Pad Set Name</label>
          <input
            id="padset-name"
            class="field"
            type="text"
            .value=${this._padSetName}
            @input=${this._handleNameInput}
            placeholder="e.g. Warm Pads - Churchfront"
          />
        </div>

        <div>
          <label for="padset-file-input">Pad Set ZIP File</label>
          <input
            id="padset-file-input"
            ${ref(this._fileInput)}
            class="field"
            type="file"
            accept=".zip"
            @change=${this._handleFileChange}
            ?disabled=${this._uploading}
          />
          ${this._fileName ? html`<div class="padset-meta">Selected: ${this._fileName}</div>` : ''}
        </div>

        ${this._error ? html`<div class="status-message error">${this._error}</div>` : ''}
        ${
          this._successMessage
            ? html`<div class="status-message success">${this._successMessage}</div>`
            : ''
        }

        <div class="actions">
          <button
            type="submit"
            class="btn primary"
            ?disabled=${this._uploading || !this._selectedFile}
          >
            ${this._uploading ? 'Uploading…' : 'Upload Pad Set'}
          </button>
        </div>
      </form>
    `
  }
}

customElements.define('pad-set-manager', PadSetManager)
