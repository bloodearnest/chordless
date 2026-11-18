import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Space } from '../js/data-types.ts'
import type { SignInState } from '../js/google-auth.ts'
import { rich } from '../js/rich-text.ts'
import { type BackupFile, downloadBackup } from '../js/space-backup.ts'
import { deleteSpaceEverywhere, mayDeleteEverywhere } from '../js/space-deletion.ts'
import type { SpaceSummary } from '../js/space-summary.ts'
import { t } from '../js/text.ts'
import { formatBytes } from '../js/utils/bytes.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles } from './shared-styles.ts'

/** The space was deleted everywhere: from Drive (to the trash) and from this device */
export class SpaceDeletedEvent extends Event {
  static readonly type = 'space-delete-everywhere:deleted'
  /** It was the one in use, so the app has another now and the page should start in it */
  readonly wasCurrent: boolean
  constructor(wasCurrent: boolean) {
    super(SpaceDeletedEvent.type, { bubbles: true, composed: true })
    this.wasCurrent = wasCurrent
  }
}

/**
 * Delete a space everywhere (docs/SPACES.md, "Deleting a space"): its Drive folder, with everything
 * in it, goes to the Drive trash, and it is gone from this device. For a Team only an admin or the
 * owner may. It is the most that can be done to a space, so it asks for three things before it
 * does it: a backup downloaded here (an export, which it makes itself), the space's name typed, and
 * a press of the button that says what it does.
 *
 * @fires SpaceDeletedEvent - when it is done
 */
export class SpaceDeleteEverywhere extends LitElement {
  static override properties = {
    space: { attribute: false },
    summary: { attribute: false },
    signIn: { attribute: false },
    _backup: { state: true },
    _typed: { state: true },
    _busy: { state: true },
    _error: { state: true },
  }

  declare space: Space
  declare summary: SpaceSummary | null
  declare signIn: SignInState | null
  /** The backup made for this question, once it is */
  declare _backup: BackupFile | null
  declare _typed: string
  declare _busy: '' | 'backup' | 'delete'
  declare _error: string

  /* v8 ignore next 4 -- the real ones are tested where they are; a test gives its own */
  /** Make and download the backup (a test gives its own) */
  backup: (space: Space) => Promise<BackupFile> = space => downloadBackup(space)
  /** Do it (a test gives its own) */
  deleter: (space: Space) => Promise<{ wasCurrent: boolean }> = deleteSpaceEverywhere

  _modal: Ref<AppModal> = createRef()

  static override styles = [
    buttonStyles,
    css`
      :host { display: block; }
      .hint { font-size: var(--font-ui-small); opacity: 0.75; }
      .error { color: var(--color-danger, #e74c3c); font-weight: 600; }
      .step { margin: 1rem 0 0; }
      .step input { font: inherit; padding: 0.4rem; width: 100%; box-sizing: border-box; }
      .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; justify-content: flex-end; }
      ul { margin: 0.5rem 0; padding-left: 1.25rem; }
    `,
  ]

  constructor() {
    super()
    this.summary = null
    this.signIn = null
    this._backup = null
    this._typed = ''
    this._busy = ''
    this._error = ''
  }

  /** Whether Drive can be reached: a Team's folder through the Worker (a sign-in is enough), any other with Drive */
  get _reachable(): boolean {
    if (this.signIn === 'signed-in') return true
    return this.signIn === 'no-drive' && Boolean(this.space.team)
  }

  /** Whether the name has been typed, as it is (spaces at either end do not count) */
  get _named(): boolean {
    return this._typed.trim() === this.space.name
  }

  _open(): void {
    this._backup = null
    this._typed = ''
    this._error = ''
    this._modal.value?.show()
  }

  async _makeBackup(): Promise<void> {
    this._busy = 'backup'
    this._error = ''
    try {
      this._backup = await this.backup(this.space)
    } catch (error) {
      this._error = t('de-backup-failed', { reason: errorMessage(error) })
    }
    this._busy = ''
  }

  async _delete(): Promise<void> {
    if (!this._backup || !this._named) return
    this._busy = 'delete'
    this._error = ''
    try {
      const { wasCurrent } = await this.deleter(this.space)
      this._modal.value?.close()
      this.dispatchEvent(new SpaceDeletedEvent(wasCurrent))
    } catch (error) {
      this._error = errorMessage(error)
    }
    this._busy = ''
  }

  _what() {
    const { songs = 0, setlists = 0 } = this.summary ?? {}
    const has = this.summary === null ? '' : ` ${t('de-holds', { songs, setlists })}`
    return `${t(this.space.team ? 'de-what-team' : 'de-what-personal')}${has}`
  }

  override render() {
    const space = this.space
    if (!mayDeleteEverywhere(space)) {
      return html`<p class="hint">${t('de-only-admin')}</p>`
    }
    const busy = this._busy !== ''
    return html`
      <button class="btn danger" id="delete-everywhere" ?disabled=${!this._reachable} @click=${this._open}>
        ${t('de-button')}
      </button>
      ${this._reachable ? nothing : html`<p class="hint">${t('de-sign-in')}</p>`}
      <app-modal ${ref(this._modal)} heading=${t('de-heading', { space: space.name })}>
        <p>${this._what()}</p>
        <ul>
          <li>${t('de-item-trash')}</li>
          ${
            space.team
              ? html`<li>${t('de-item-team')}</li>`
              : html`<li>${t('de-item-personal')}</li>`
          }
          <li>${t('de-item-device')}</li>
        </ul>

        <div class="step">
          ${rich('de-step-backup', undefined, { strong: words => html`<strong>${words}</strong>` })}
          <p class="hint">${t('de-backup-text')}</p>
          <button class="btn" id="make-backup" ?disabled=${busy} @click=${this._makeBackup}>
            ${this._backup ? t('de-backup-again') : t('de-backup-button')}
          </button>
          ${
            this._backup
              ? html`<span role="status">
                ${t('de-backup-done', { file: this._backup.fileName, size: formatBytes(this._backup.bytes) })}
              </span>`
              : html`<span class="hint">${t('de-backup-needed')}</span>`
          }
        </div>

        <div class="step">
          <label for="confirm-name">${rich('de-step-name', { space: space.name }, { strong: words => html`<strong>${words}</strong>` })}</label>
          <input
            id="confirm-name"
            .value=${this._typed}
            @input=${(event: Event) => {
              this._typed = (event.target as HTMLInputElement).value
            }}
            ?disabled=${busy}
            autocomplete="off"
            spellcheck="false"
          />
        </div>

        ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
        <div class="actions step" slot="actions">
          <button class="btn" id="cancel-delete" ?disabled=${busy} @click=${() => this._modal.value?.close()}>
            ${t('action-cancel')}
          </button>
          <button
            class="btn danger"
            id="do-delete"
            ?disabled=${busy || !this._backup || !this._named}
            @click=${this._delete}
          >
            ${this._busy === 'delete' ? t('de-deleting') : t('de-do-delete')}
          </button>
        </div>
      </app-modal>
    `
  }
}
customElements.define('space-delete-everywhere', SpaceDeleteEverywhere)

declare global {
  interface HTMLElementTagNameMap {
    'space-delete-everywhere': SpaceDeleteEverywhere
  }
}
