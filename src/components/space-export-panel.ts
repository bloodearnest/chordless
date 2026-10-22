import { css, html, LitElement, nothing } from 'lit'
import type { Space } from '../js/data-types.ts'
import { withSource } from '../js/other-songs.ts'
import { listPadSets, type PadSet, padSetSize } from '../js/pad-set-service.ts'
import {
  createExport,
  exportFileName,
  importIntoSpace,
  importPadSets,
  readExport,
  readPadSetsForExport,
  type SpaceExport,
} from '../js/space-export.ts'
import { errorMessage } from '../js/utils/errors.ts'
import { buttonStyles } from './shared-styles.ts'

/** The pad sets in Drive that an export could include, with their sizes */
interface PadSetChoice {
  padSet: PadSet
  bytes: number
}

/** An import the user has chosen a file for and not yet confirmed */
interface PendingImport {
  exported: SpaceExport
  pads: boolean
}

export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`
}

/**
 * Exporting a space to a zip file, and importing one into it (docs/SPACES.md, "Export and
 * import"). The pad sets are large, so they go in only if the user ticks them, with their size
 * shown; they live in the signed-in account's Drive, so they need the user signed in.
 */
export class SpaceExportPanel extends LitElement {
  static override properties = {
    space: { attribute: false },
    signedIn: { type: Boolean, attribute: 'signed-in' },
    showPads: { type: Boolean, attribute: 'show-pads' },
    _padSets: { state: true },
    _includePads: { state: true },
    _busy: { state: true },
    _message: { state: true },
    _pending: { state: true },
  }

  static override styles = [
    buttonStyles,
    css`
      :host {
        display: block;
      }
      .row {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      fieldset {
        border: 1px solid var(--border-color, #d5dbdb);
        border-radius: 8px;
        padding: 0.75rem 1rem;
        margin: 1rem 0 0;
      }
      .message {
        margin: 0.75rem 0 0;
      }
      .message.error {
        color: var(--color-danger, #c0392b);
      }
      .meta {
        font-size: var(--font-ui-small);
        opacity: 0.8;
      }
      input[type='file'] {
        display: none;
      }
    `,
  ]

  /** The space to export, or to import into: any on this device, not only the one in use */
  declare space: Space
  declare signedIn: boolean
  /** Whether pad sets are on offer: only while the media player is, as nothing else uses them */
  declare showPads: boolean
  declare _padSets: PadSetChoice[]
  declare _includePads: boolean
  declare _busy: boolean
  declare _message: { text: string; kind: 'info' | 'error' } | null
  declare _pending: PendingImport | null

  constructor() {
    super()
    this.signedIn = false
    this.showPads = false
    this._padSets = []
    this._includePads = false
    this._busy = false
    this._message = null
    this._pending = null
  }

  override connectedCallback() {
    super.connectedCallback()
    void this._loadPadSets()
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has('signedIn') || changed.has('showPads')) void this._loadPadSets()
  }

  /** The pad sets in Drive and their sizes; none if the user is not signed in or is offline */
  async _loadPadSets() {
    if (!this.signedIn || !this.showPads) {
      this._padSets = []
      this._includePads = false
      return
    }
    try {
      const sets = await listPadSets()
      this._padSets = await Promise.all(
        sets.map(async padSet => ({ padSet, bytes: await padSetSize(padSet) }))
      )
    } catch {
      // (offline, or Drive would not say: the export is then of the space alone)
      this._padSets = []
      this._includePads = false
    }
  }

  get _padBytes(): number {
    return this._padSets.reduce((total, set) => total + set.bytes, 0)
  }

  async _download() {
    this._busy = true
    this._message = null
    try {
      const name = this.space.name
      const pads = this._includePads
        ? await readPadSetsForExport(this._padSets.map(set => set.padSet))
        : []
      const blob = await withSource(this.space.id, db => createExport(db, name, pads))
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = exportFileName(name)
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
      this._message = {
        text: `Exported as ${link.download} (${megabytes(blob.size)}).`,
        kind: 'info',
      }
    } catch (error) {
      this._message = { text: `Exporting failed: ${errorMessage(error)}`, kind: 'error' }
    } finally {
      this._busy = false
    }
  }

  async _fileChosen(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    this._message = null
    try {
      const exported = await readExport(file)
      this._pending = { exported, pads: false }
    } catch (error) {
      this._pending = null
      this._message = { text: errorMessage(error), kind: 'error' }
    }
  }

  async _import() {
    const pending = this._pending
    if (!pending) return
    this._busy = true
    this._message = null
    try {
      const { exported } = pending
      const where = this.space.name
      const report = await withSource(this.space.id, db => importIntoSpace(exported, db))
      const pads =
        pending.pads && this.signedIn
          ? await importPadSets(
              exported,
              exported.manifest.padSets.map(set => set.name)
            )
          : []
      this._pending = null
      // (the space has more in it now: whoever shows what it holds can look again)
      this.dispatchEvent(
        new Event('space-export-panel:imported', { bubbles: true, composed: true })
      )
      this._message = {
        text:
          `Imported into ${where}: ${report.songsAdded} charts and ${report.setlistsAdded} setlists added` +
          `, ${report.songsSkipped} charts and ${report.setlistsSkipped} setlists were already there` +
          (pads.length > 0 ? `; ${pads.length} pad sets uploaded to Drive` : '') +
          '.',
        kind: 'info',
      }
    } catch (error) {
      this._message = { text: `Importing failed: ${errorMessage(error)}`, kind: 'error' }
    } finally {
      this._busy = false
    }
  }

  _renderPending(pending: PendingImport) {
    const { manifest } = pending.exported
    const { songs, setlists, padSets } = manifest.counts
    const when = new Date(manifest.created).toLocaleString()
    return html`
      <fieldset>
        <legend>Import this export into ${this.space.name}</legend>
        <p class="meta">
          Exported from ${manifest.space}, ${when}: ${songs} charts, ${setlists} setlists${
            padSets > 0 ? html`, ${padSets} pad sets` : nothing
          }. Nothing is deleted: only what is missing is added.
        </p>
        <div class="row">
          ${
            padSets > 0
              ? html`<label>
                <input
                  type="checkbox"
                  id="import-pads"
                  .checked=${pending.pads}
                  ?disabled=${!this.signedIn}
                  @change=${(event: Event) => {
                    this._pending = { ...pending, pads: (event.target as HTMLInputElement).checked }
                  }}
                />
                Also upload its pad sets to Google Drive${
                  this.signedIn ? '' : ' (connect with Google first)'
                }. A pad set with the same name there is replaced.
              </label>`
              : nothing
          }
          <div>
            <button class="btn primary" id="import" ?disabled=${this._busy} @click=${() => this._import()}>
              ${this._busy ? 'Importing…' : 'Import'}
            </button>
            <button class="btn" id="import-cancel" ?disabled=${this._busy} @click=${() => {
              this._pending = null
            }}>
              Cancel
            </button>
          </div>
        </div>
      </fieldset>
    `
  }

  override render() {
    return html`
      <div class="row">
        ${
          this._padSets.length > 0
            ? html`<label>
              <input
                type="checkbox"
                id="include-pads"
                .checked=${this._includePads}
                @change=${(event: Event) => {
                  this._includePads = (event.target as HTMLInputElement).checked
                }}
              />
              Include my pad sets (${this._padSets.length}, about ${megabytes(this._padBytes)})
            </label>`
            : nothing
        }
        <div>
          <button class="btn primary" id="export-space" ?disabled=${this._busy} @click=${() => this._download()}>
            ${this._busy && !this._pending ? 'Exporting…' : '📦 Export this space'}
          </button>
          <button class="btn" id="choose-export" ?disabled=${this._busy} @click=${() => this.shadowRoot?.querySelector<HTMLInputElement>('input[type=file]')?.click()}>
            📥 Import a Chordless export…
          </button>
          <input type="file" accept=".zip,application/zip" @change=${(event: Event) => this._fileChosen(event)} />
        </div>
        ${this._pending ? this._renderPending(this._pending) : nothing}
        ${
          this._message
            ? html`<p
                class="message ${this._message.kind}"
                role=${this._message.kind === 'error' ? 'alert' : 'status'}
              >
                ${this._message.text}
              </p>`
            : nothing
        }
      </div>
    `
  }
}
customElements.define('space-export-panel', SpaceExportPanel)

declare global {
  interface HTMLElementTagNameMap {
    'space-export-panel': SpaceExportPanel
  }
}
