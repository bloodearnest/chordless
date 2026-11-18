import { css, html, LitElement, nothing } from 'lit'
import type { Space } from '../js/data-types.ts'
import { withSource } from '../js/other-songs.ts'
import { listPadSets, type PadSet, padSetSize } from '../js/pad-set-service.ts'
import { restorePersonalLayer } from '../js/personal-layer.ts'
import { downloadBackup } from '../js/space-backup.ts'
import {
  importIntoSpace,
  importPadSets,
  readExport,
  readPadSetsForExport,
  type SpaceExport,
} from '../js/space-export.ts'
import { planReset, type ResetPlan, resetToExport } from '../js/space-restore.ts'
import { t } from '../js/text.ts'
import { errorMessage, failedWith, whatToSay } from '../js/utils/errors.ts'
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
  /** Whether to put back what the file holds of the person's own settings and annotations */
  personal: boolean
}

/** An import was added to the space: whoever shows what it holds can look again */
export class SpaceImportedEvent extends Event {
  static readonly type = 'space-export-panel:imported'
  constructor() {
    super(SpaceImportedEvent.type, { bubbles: true, composed: true })
  }
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
    _includePersonal: { state: true },
    _busy: { state: true },
    _message: { state: true },
    _pending: { state: true },
    _reset: { state: true },
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
  declare _includePersonal: boolean
  declare _busy: boolean
  declare _message: { text: string; kind: 'info' | 'error' } | null
  declare _pending: PendingImport | null
  /** What a reset to the chosen export would do, shown for the user to confirm */
  declare _reset: ResetPlan | null

  constructor() {
    super()
    this.signedIn = false
    this.showPads = false
    this._padSets = []
    this._includePads = false
    this._includePersonal = true
    this._busy = false
    this._message = null
    this._pending = null
    this._reset = null
  }

  override connectedCallback() {
    super.connectedCallback()
    void this._loadPadSets()
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has('signedIn') || changed.has('showPads')) void this._loadPadSets()
  }

  /**
   * The space's pad sets in Drive and their sizes; none if the user is not signed in or is offline
   */
  async _loadPadSets() {
    if (!this.signedIn || !this.showPads) {
      this._padSets = []
      this._includePads = false
      return
    }
    try {
      const sets = (await listPadSets()).filter(padSet => padSet.spaceId === this._padSpaceId)
      this._padSets = await Promise.all(
        sets.map(async padSet => ({ padSet, bytes: await padSetSize(padSet) }))
      )
    } catch {
      // (offline, or Drive would not say: the export is then of the space alone)
      this._padSets = []
      this._includePads = false
    }
  }

  /** The space whose pads are this space's: each keeps its own */
  get _padSpaceId(): string {
    return this.space.id
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
      const { fileName, bytes } = await downloadBackup(
        { id: this.space.id, name },
        pads,
        this._includePersonal
      )
      this._message = {
        text: t('export-done', { file: fileName, size: megabytes(bytes) }),
        kind: 'info',
      }
    } catch (error) {
      this._message = {
        text: failedWith(
          error,
          t('export-failed', { reason: errorMessage(error) }),
          t('export-failed-plain')
        ),
        kind: 'error',
      }
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
      this._pending = { exported, pads: false, personal: true }
      this._reset = null
    } catch (error) {
      this._pending = null
      this._message = { text: whatToSay(error, t('export-read-failed')), kind: 'error' }
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
      const { report, restored } = await withSource(this.space.id, async db => {
        const report = await importIntoSpace(exported, db)
        const restored =
          pending.personal && exported.personal
            ? await restorePersonalLayer(exported.personal, db)
            : null
        return { report, restored }
      })
      const pads =
        pending.pads && this.signedIn
          ? await importPadSets(
              exported,
              exported.manifest.padSets.map(set => set.name),
              this._padSpaceId
            )
          : []
      this._pending = null
      // (the space has more in it now: whoever shows what it holds can look again)
      this.dispatchEvent(new SpaceImportedEvent())
      this._message = {
        // (the clauses that are so, one after the other: the first, then each of the others, and a full stop)
        text: `${[
          t('export-imported', {
            where,
            songsAdded: report.songsAdded,
            setlistsAdded: report.setlistsAdded,
            songsSkipped: report.songsSkipped,
            setlistsSkipped: report.setlistsSkipped,
          }),
          report.scoresAdded > 0
            ? t('export-lead-sheets-added', { count: report.scoresAdded })
            : '',
          restored && restored.setlists + restored.preferences > 0
            ? t('export-personal-restored', { count: restored.setlists })
            : '',
          pads.length > 0 ? t('export-pads-uploaded', { count: pads.length }) : '',
        ]
          .filter(Boolean)
          .join('; ')}.`,
        kind: 'info',
      }
    } catch (error) {
      this._message = {
        text: failedWith(
          error,
          t('import-failed', { reason: errorMessage(error) }),
          t('import-failed-plain')
        ),
        kind: 'error',
      }
    } finally {
      this._busy = false
    }
  }

  /** Work out what a reset to the chosen export would change, and show it */
  async _planReset() {
    const pending = this._pending
    if (!pending) return
    this._busy = true
    this._message = null
    try {
      this._reset = await withSource(this.space.id, db => planReset(pending.exported, db))
    } catch (error) {
      this._message = {
        text: failedWith(
          error,
          t('export-check-failed', { reason: errorMessage(error) }),
          t('export-check-failed-plain')
        ),
        kind: 'error',
      }
    } finally {
      this._busy = false
    }
  }

  async _doReset() {
    const pending = this._pending
    if (!pending || !this._reset) return
    this._busy = true
    this._message = null
    try {
      const where = this.space.name
      const report = await withSource(this.space.id, db => resetToExport(pending.exported, db))
      this._pending = null
      this._reset = null
      this.dispatchEvent(new SpaceImportedEvent())
      this._message = {
        text: `${[
          t('export-reset-done', {
            where,
            songsReplaced: report.songsReplaced,
            setlistsReplaced: report.setlistsReplaced,
            songsAdded: report.songsAdded,
            setlistsAdded: report.setlistsAdded,
            songsSame: report.songsSame,
            setlistsSame: report.setlistsSame,
          }),
          report.songsOnlyHere + report.setlistsOnlyHere > 0
            ? t('export-reset-kept', {
                songs: report.songsOnlyHere,
                setlists: report.setlistsOnlyHere,
              })
            : '',
          report.scoresAdded > 0
            ? t('export-lead-sheets-added', { count: report.scoresAdded })
            : '',
        ]
          .filter(Boolean)
          .join('; ')}. ${t('export-reset-sync')}`,
        kind: 'info',
      }
    } catch (error) {
      this._message = {
        text: failedWith(
          error,
          t('export-reset-failed', { reason: errorMessage(error) }),
          t('export-reset-failed-plain')
        ),
        kind: 'error',
      }
    } finally {
      this._busy = false
    }
  }

  _renderReset(plan: ResetPlan) {
    const replaced = plan.songsReplaced.length + plan.setlistsReplaced.length
    const added = plan.songsAdded.length + plan.setlistsAdded.length
    const newer = [...plan.songsReplaced, ...plan.setlistsReplaced].filter(item => item.newerHere)
    return html`
      <fieldset>
        <legend>${t('export-reset-legend', { space: this.space.name })}</legend>
        <p class="meta">
          ${t('export-reset-plan', {
            songsReplaced: plan.songsReplaced.length,
            setlistsReplaced: plan.setlistsReplaced.length,
            songsAdded: plan.songsAdded.length,
            setlistsAdded: plan.setlistsAdded.length,
            same: plan.songsSame + plan.setlistsSame,
          })}
          ${
            plan.songsOnlyHere + plan.setlistsOnlyHere > 0
              ? t('export-reset-only-here', {
                  songs: plan.songsOnlyHere,
                  setlists: plan.setlistsOnlyHere,
                })
              : nothing
          }
          ${t('export-reset-drive')}
        </p>
        ${
          newer.length > 0
            ? html`<p class="message error" role="alert">
                ${t(newer.length > 8 ? 'export-reset-newer-more' : 'export-reset-newer', {
                  count: newer.length,
                  labels: newer
                    .slice(0, 8)
                    .map(item => item.label)
                    .join(', '),
                  more: newer.length - 8,
                })}
              </p>`
            : nothing
        }
        <div class="row">
          <div>
            <button class="btn" id="reset-backup" ?disabled=${this._busy} @click=${() => this._download()}>
              ${t('export-first')}
            </button>
          </div>
          <div>
            <button
              class="btn primary"
              id="reset-confirm"
              ?disabled=${this._busy || replaced + added === 0}
              @click=${() => this._doReset()}
            >
              ${this._busy ? t('export-resetting') : replaced + added === 0 ? t('export-nothing') : t('export-reset-button')}
            </button>
            <button class="btn" id="reset-cancel" ?disabled=${this._busy} @click=${() => {
              this._reset = null
            }}>
              ${t('action-cancel')}
            </button>
          </div>
        </div>
      </fieldset>
    `
  }

  _renderPending(pending: PendingImport) {
    const { manifest } = pending.exported
    const { songs, setlists, padSets } = manifest.counts
    const when = new Date(manifest.created).toLocaleString()
    return html`
      <fieldset>
        <legend>${t('export-import-legend', { space: this.space.name })}</legend>
        <p class="meta">
          ${t(padSets > 0 ? 'export-from-pads' : 'export-from', { space: manifest.space, when, songs, setlists, padSets })}
          ${t('export-import-note')}
        </p>
        <div class="row">
          ${
            pending.exported.personal
              ? html`<label>
                <input
                  type="checkbox"
                  id="import-personal"
                  .checked=${pending.personal}
                  @change=${(event: Event) => {
                    this._pending = {
                      ...pending,
                      personal: (event.target as HTMLInputElement).checked,
                    }
                  }}
                />
                ${t('export-also-personal')}
              </label>`
              : nothing
          }
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
                ${t(this.signedIn ? 'export-also-pads' : 'export-also-pads-offline')}
              </label>`
              : nothing
          }
          <div>
            <button class="btn primary" id="import" ?disabled=${this._busy} @click=${() => this._import()}>
              ${this._busy && !this._reset ? t('export-importing') : t('import-button')}
            </button>
            <button class="btn" id="reset-start" ?disabled=${this._busy} @click=${() => this._planReset()}>
              ${t('export-reset-start')}
            </button>
            <button class="btn" id="import-cancel" ?disabled=${this._busy} @click=${() => {
              this._pending = null
              this._reset = null
            }}>
              ${t('action-cancel')}
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
              ${t('export-include-pads', { count: this._padSets.length, size: megabytes(this._padBytes) })}
            </label>`
            : nothing
        }
        <label>
          <input
            type="checkbox"
            id="include-personal"
            .checked=${this._includePersonal}
            @change=${(event: Event) => {
              this._includePersonal = (event.target as HTMLInputElement).checked
            }}
          />
          ${t('export-include-personal')}
        </label>
        <div>
          <button class="btn primary" id="export-space" ?disabled=${this._busy} @click=${() => this._download()}>
            ${this._busy && !this._pending ? t('export-exporting') : t('export-button')}
          </button>
          <button class="btn" id="choose-export" ?disabled=${this._busy} @click=${() => this.shadowRoot?.querySelector<HTMLInputElement>('input[type=file]')?.click()}>
            ${t('export-choose')}
          </button>
          <input type="file" accept=".zip,application/zip" @change=${(event: Event) => this._fileChosen(event)} />
        </div>
        ${this._pending ? this._renderPending(this._pending) : nothing}
        ${this._pending && this._reset ? this._renderReset(this._reset) : nothing}
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
