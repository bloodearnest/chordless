import { css, html, LitElement } from 'lit'
import { ifDefined } from 'lit/directives/if-defined.js'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import { derivePadSetName, uploadPadSet } from '../js/pad-set-service.ts'
import { errorMessage } from '../js/utils/errors.ts'
import { buttonStyles, fieldStyles } from './shared-styles.ts'

/** A pad set was uploaded (to this device and to Google Drive when signed in) */
export class PadSetUploadedEvent extends Event {
  static readonly type = 'pad-set-upload:uploaded'
  constructor() {
    super(PadSetUploadedEvent.type, { bubbles: true, composed: true })
  }
}

/**
 * Uploading a pad set: a name, and a zip of the pads (all 12 keys). It is the form under the pad
 * select on the media player page, opened by the select's "Upload a new pad set…". The set is kept
 * on this device and uploaded to Google Drive when the person is signed in.
 *
 * @fires PadSetUploadedEvent - when the set is uploaded
 */
export class PadSetUpload extends LitElement {
  static override properties = {
    _uploading: { state: true },
    _progress: { state: true },
    _error: { state: true },
    _padSetName: { state: true },
    _fileName: { state: true },
  }

  declare _uploading: boolean
  /** Pads uploaded so far and in all, or null before the upload has got as far as the pads */
  declare _progress: { done: number; total: number } | null
  declare _error: string
  declare _padSetName: string
  declare _fileName: string

  _fileInput: Ref<HTMLInputElement> = createRef()
  _selectedFile: File | null = null

  static override styles = [
    buttonStyles,
    fieldStyles,
    css`
      :host {
        display: block;
      }

      form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-top: 0.75rem;
      }

      label {
        font-size: var(--font-ui);
        font-weight: 500;
      }

      .meta {
        font-size: var(--font-ui-small);
        opacity: 0.7;
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

      progress {
        width: 100%;
        height: 0.5rem;
      }
    `,
  ]

  constructor() {
    super()
    this._uploading = false
    this._progress = null
    this._error = ''
    this._padSetName = ''
    this._fileName = ''
  }

  _handleFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] || null
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

  _handleNameInput(event: Event): void {
    const input = event.target as HTMLInputElement
    const raw = input.value
    const sanitized = raw.replace(/[^a-zA-Z0-9\s-]+/g, '')
    if (sanitized !== raw) {
      /* v8 ignore next -- a text field always has a cursor position; null is for other inputs */
      const pos = (input.selectionStart ?? 0) - (raw.length - sanitized.length)
      input.value = sanitized
      input.setSelectionRange(Math.max(0, pos), Math.max(0, pos))
    }
    this._padSetName = sanitized
  }

  async _handleUpload(event: Event): Promise<void> {
    event.preventDefault()
    this._error = ''

    if (!this._selectedFile) {
      this._error = 'Please select a ZIP file to upload.'
      return
    }

    this._uploading = true
    try {
      await uploadPadSet(this._selectedFile, this._padSetName, (done, total) => {
        this._progress = { done, total }
      })
      this._selectedFile = null
      this._padSetName = ''
      this._fileName = ''
      if (this._fileInput.value) this._fileInput.value.value = ''
      this.dispatchEvent(new PadSetUploadedEvent())
    } catch (error) {
      console.error('[PadSetUpload] Upload failed:', error)
      /* v8 ignore next -- only for an error with no message, which the upload does not throw */
      this._error = errorMessage(error) || 'Failed to upload pad set.'
    } finally {
      this._uploading = false
      this._progress = null
    }
  }

  override render() {
    return html`
      <form @submit=${this._handleUpload}>
        <div>
          <label for="padset-name">Pad set name</label>
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
          <label for="padset-file-input">Zip file of the pads</label>
          <input
            id="padset-file-input"
            ${ref(this._fileInput)}
            class="field"
            type="file"
            accept=".zip"
            @change=${this._handleFileChange}
            ?disabled=${this._uploading}
          />
          ${this._fileName ? html`<div class="meta">Selected: ${this._fileName}</div>` : ''}
        </div>

        ${this._error ? html`<div class="status-message error">${this._error}</div>` : ''}

        ${
          this._uploading
            ? html`<progress
              aria-label="Uploading pad set"
              max=${this._progress?.total ?? 1}
              value=${ifDefined(this._progress?.done)}
            ></progress>`
            : ''
        }

        <div class="actions">
          <button
            type="submit"
            class="btn primary"
            ?disabled=${this._uploading || !this._selectedFile}
          >
            ${this._uploading ? 'Uploading…' : 'Upload pad set'}
          </button>
        </div>
      </form>
    `
  }
}

customElements.define('pad-set-upload', PadSetUpload)

declare global {
  interface HTMLElementTagNameMap {
    'pad-set-upload': PadSetUpload
  }
}
