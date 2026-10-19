import { css, html, LitElement, nothing } from 'lit'
import {
  type Backup,
  backupFileName,
  createBackup,
  readBackup,
  readPadSetsForBackup,
  restoreBackup,
  restorePadSets,
} from '../js/backup.ts'
import { ChordlessDB, getCurrentDB } from '../js/db.ts'
import {
  createOrganisation,
  getCurrentOrganisation,
  listOrganisations,
} from '../js/organisation.ts'
import { listPadSets, type PadSet, padSetSize } from '../js/pad-set-service.ts'
import { errorMessage } from '../js/utils/errors.ts'
import { buttonStyles } from './shared-styles.ts'

/** The pad sets in Drive that a backup could include, with their sizes */
interface PadSetChoice {
  padSet: PadSet
  bytes: number
}

/** A restore the user has chosen a file for and not yet confirmed */
interface PendingRestore {
  backup: Backup
  into: 'current' | 'new'
  pads: boolean
}

export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`
}

/** "Name (restored)", or with a number if the space already has one of that name */
export function restoredName(name: string, taken: string[]): string {
  let candidate = `${name} (restored)`
  for (let n = 2; taken.includes(candidate); n++) candidate = `${name} (restored ${n})`
  return candidate
}

/**
 * Backing up the current space to a zip file, and restoring one (docs/SPACES.md, "Backup and
 * restore"). The pad sets are large, so they go in only if the user ticks them, with their size
 * shown; they live in the signed-in account's Drive, so they need the user signed in.
 */
export class BackupPanel extends LitElement {
  static override properties = {
    signedIn: { type: Boolean, attribute: 'signed-in' },
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

  declare signedIn: boolean
  declare _padSets: PadSetChoice[]
  declare _includePads: boolean
  declare _busy: boolean
  declare _message: { text: string; kind: 'info' | 'error' } | null
  declare _pending: PendingRestore | null

  constructor() {
    super()
    this.signedIn = false
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
    if (changed.has('signedIn')) void this._loadPadSets()
  }

  /** The pad sets in Drive and their sizes; none if the user is not signed in or is offline */
  async _loadPadSets() {
    if (!this.signedIn) {
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
      // (offline, or Drive would not say: the backup is then of the space alone)
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
      const db = await getCurrentDB()
      const name = getCurrentOrganisation().name
      const pads = this._includePads
        ? await readPadSetsForBackup(this._padSets.map(set => set.padSet))
        : []
      const blob = await createBackup(db, name, pads)
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = backupFileName(name)
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
      this._message = {
        text: `Backup saved as ${link.download} (${megabytes(blob.size)}).`,
        kind: 'info',
      }
    } catch (error) {
      this._message = { text: `Making the backup failed: ${errorMessage(error)}`, kind: 'error' }
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
      const backup = await readBackup(file)
      this._pending = { backup, into: 'current', pads: false }
    } catch (error) {
      this._pending = null
      this._message = { text: errorMessage(error), kind: 'error' }
    }
  }

  async _restore() {
    const pending = this._pending
    if (!pending) return
    this._busy = true
    this._message = null
    try {
      const { backup } = pending
      let into: ChordlessDB
      let where = `this space (${getCurrentOrganisation().name})`
      if (pending.into === 'new') {
        const taken = (await listOrganisations()).map(space => space.name)
        const space = await createOrganisation(restoredName(backup.manifest.space, taken))
        into = new ChordlessDB(space.id)
        await into.init()
        where = `a new space, ${space.name}: switch to it in the Space section above`
      } else {
        into = await getCurrentDB()
      }
      let report: Awaited<ReturnType<typeof restoreBackup>>
      try {
        report = await restoreBackup(backup, into)
      } finally {
        if (pending.into === 'new') into.db?.close()
      }
      const pads =
        pending.pads && this.signedIn
          ? await restorePadSets(
              backup,
              backup.manifest.padSets.map(set => set.name)
            )
          : []
      this._pending = null
      this._message = {
        text:
          `Restored into ${where}: ${report.songsAdded} charts and ${report.setlistsAdded} setlists added` +
          `, ${report.songsSkipped} charts and ${report.setlistsSkipped} setlists were already there` +
          (pads.length > 0 ? `; ${pads.length} pad sets uploaded to Drive` : '') +
          '.',
        kind: 'info',
      }
    } catch (error) {
      this._message = { text: `Restoring failed: ${errorMessage(error)}`, kind: 'error' }
    } finally {
      this._busy = false
    }
  }

  _renderPending(pending: PendingRestore) {
    const { manifest } = pending.backup
    const { songs, setlists, padSets } = manifest.counts
    const when = new Date(manifest.created).toLocaleString()
    return html`
      <fieldset>
        <legend>Restore this backup</legend>
        <p class="meta">
          Backup of ${manifest.space}, ${when}: ${songs} charts, ${setlists} setlists${
            padSets > 0 ? html`, ${padSets} pad sets` : nothing
          }. Nothing is deleted: only what is missing is added.
        </p>
        <div class="row">
          <label>
            <input
              type="radio"
              name="into"
              id="restore-current"
              .checked=${pending.into === 'current'}
              @change=${() => {
                this._pending = { ...pending, into: 'current' }
              }}
            />
            Into this space (${getCurrentOrganisation().name})
          </label>
          <label>
            <input
              type="radio"
              name="into"
              id="restore-new"
              .checked=${pending.into === 'new'}
              @change=${() => {
                this._pending = { ...pending, into: 'new' }
              }}
            />
            Into a new space, ${manifest.space} (restored)
          </label>
          ${
            padSets > 0
              ? html`<label>
                <input
                  type="checkbox"
                  id="restore-pads"
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
            <button class="btn primary" id="restore" ?disabled=${this._busy} @click=${() => this._restore()}>
              ${this._busy ? 'Restoring…' : 'Restore'}
            </button>
            <button class="btn" id="restore-cancel" ?disabled=${this._busy} @click=${() => {
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
          <button class="btn primary" id="download-backup" ?disabled=${this._busy} @click=${() => this._download()}>
            ${this._busy && !this._pending ? 'Making the backup…' : '💾 Download a backup'}
          </button>
          <button class="btn" id="choose-backup" ?disabled=${this._busy} @click=${() => this.shadowRoot?.querySelector<HTMLInputElement>('input[type=file]')?.click()}>
            📤 Restore from a backup…
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
customElements.define('backup-panel', BackupPanel)

declare global {
  interface HTMLElementTagNameMap {
    'backup-panel': BackupPanel
  }
}
