import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Space } from '../js/data-types.ts'
import type { SignInState } from '../js/google-auth.ts'
import { loadMediaSettings } from '../js/media-settings.ts'
import { getSpaceById } from '../js/space.ts'
import { removeSpaceFromDevice } from '../js/space-deletion.ts'
import { spaceKind, spaceRole } from '../js/space-label.ts'
import { type SpaceSummary, summaryOf } from '../js/space-summary.ts'
import { isTeamMember } from '../js/storage/space-storage.ts'
import { t } from '../js/text.ts'
import { formatBytes } from '../js/utils/bytes.ts'
import { whatToSay } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'
import './space-export-panel.ts'

/**
 * The space is gone from this device (deleted): whoever shows this can close it. If it was the one in
 * use the app has another now (or none), and the page should start again in it.
 */
export class SpaceGoneEvent extends Event {
  static readonly type = 'space-manager:gone'
  readonly wasCurrent: boolean
  constructor(wasCurrent = false) {
    super(SpaceGoneEvent.type, { bubbles: true, composed: true })
    this.wasCurrent = wasCurrent
  }
}

/**
 * The data of one Personal space or Team (docs/ACCOUNT.md): resetting it from Drive, export and
 * import, and deleting it from this device. (Syncing and switching are on the space's card, and a
 * Team's people are the space page's own first section: people-list.ts.) It is shown in a modal over the list, like
 * the app's other settings, and works on any space on this device, not only the one in use. The name
 * is the modal's heading, so it is not repeated here.
 *
 * @fires SpaceGoneEvent - when the space is deleted
 */
export class SpaceManager extends LitElement {
  static override properties = {
    spaceId: { type: String },
    _space: { state: true },
    _summary: { state: true },
    _signIn: { state: true },
    _missing: { state: true },
    _error: { state: true },
  }

  /** The space to manage */
  declare spaceId: string
  declare _space: Space | null
  declare _summary: SpaceSummary | null
  declare _signIn: SignInState | null
  declare _missing: boolean
  declare _error: string

  _deleteModal: Ref<AppModal> = createRef()

  static override styles = [
    panelStyles,
    buttonStyles,
    css`
      :host {
        display: block;
      }
      .content {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        max-width: 800px;
        margin: 0 auto;
      }
      .head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
      .spacer { flex: 1; }
      .chip {
        font-size: var(--font-ui-small);
        padding: 0.15rem 0.6rem;
        border: 1px solid var(--panel-border, var(--tint, #ccc));
        border-radius: 999px;
        opacity: 0.85;
      }
      .meta { font-size: var(--font-ui-small); opacity: 0.75; margin: 0; }
      .danger-zone {
        border-color: color-mix(in srgb, var(--color-danger, #e74c3c) 40%, transparent);
      }
      .error { color: var(--color-danger, #e74c3c); }
      .hint { font-size: var(--font-ui-small); opacity: 0.75; }
    `,
  ]

  constructor() {
    super()
    this.spaceId = ''
    this._space = null
    this._summary = null
    this._signIn = null
    this._missing = false
    this._error = ''
  }

  override connectedCallback(): void {
    super.connectedCallback()
    void this._load()
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('spaceId') && changed.get('spaceId') !== undefined) void this._load()
  }

  async _load(): Promise<void> {
    const { getSignInState } = await import('../js/google-auth.ts')
    this._signIn = await getSignInState()
    const space = await getSpaceById(this.spaceId)
    this._missing = !space
    this._space = space ?? null
    this._summary = space ? await summaryOf(space.id) : null
  }

  /** Signed in with Google Drive: an export can take the pad audio kept there */
  get _signedInWithDrive(): boolean {
    return this._signIn === 'signed-in'
  }

  async _delete(): Promise<void> {
    const space = this._space as Space
    const modal = this._deleteModal.value as AppModal
    // (a sentence for each thing that is so, and the last one always)
    modal.message = [
      t('confirm-space-delete-message', { space: space.name }),
      isTeamMember(space) ? t('confirm-space-delete-team') : '',
      t('confirm-space-delete-final'),
    ]
      .filter(Boolean)
      .join(' ')
    if (!(await modal.ask())) return
    this._error = ''
    try {
      const { wasCurrent } = await removeSpaceFromDevice(space)
      this.dispatchEvent(new SpaceGoneEvent(wasCurrent))
    } catch (error) {
      console.error('[SpaceManager] Failed to delete the space:', error)
      this._error = whatToSay(error, t('error-something'))
    }
  }

  /** Read the space and what it holds again (it changed under the page: an import, or sharing ended) */
  _refresh(): Promise<void> {
    return this._load()
  }

  override render() {
    if (this._missing) {
      return html`<div class="content">
        <div class="panel"><p>${t('space-missing')}</p></div>
      </div>`
    }
    const space = this._space
    if (!space) return html`<div class="content"><p class="hint">${t('status-loading')}</p></div>`
    const kind = spaceKind(space)
    const role = spaceRole(space)
    const summary = this._summary
    return html`
      <div class="content">
        <div class="head">
          ${kind ? html`<span class="chip">${kind}</span>` : nothing}
          ${role ? html`<span class="chip">${role}</span>` : nothing}
          <span class="spacer"></span>
        </div>
        ${
          summary
            ? html`<p class="meta">
              ${t('space-summary', {
                songs: summary.songs,
                setlists: summary.setlists,
                size: formatBytes(summary.bytes),
              })}
            </p>`
            : nothing
        }

        <div class="panel">
          <h3>${t('space-export-heading')}</h3>
          <p>
            ${t(space.team ? 'space-export-text-team' : 'space-export-text')}
          </p>
          <space-export-panel
            .space=${space}
            ?show-pads=${loadMediaSettings().mediaPlayerEnabled}
            ?signed-in=${this._signedInWithDrive}
            @space-export-panel:imported=${this._refresh}
          ></space-export-panel>
        </div>

        <div class="panel danger-zone">
          <h3>${t('space-delete-heading')}</h3>
          <p>
            ${t(space.team ? 'space-delete-text-team' : 'space-delete-text')}
          </p>
          <button class="btn danger" id="delete" @click=${this._delete}>${t('space-delete-button')}</button>
          ${this._error ? html`<p class="error" role="alert">${t('space-delete-failed', { reason: this._error })}</p>` : nothing}
        </div>

      </div>
      <app-modal
        ${ref(this._deleteModal)}
        type="confirm"
        heading=${t('confirm-space-delete-heading')}
        confirm-label=${t('confirm-space-delete-button')}
      ></app-modal>
    `
  }
}
customElements.define('space-manager', SpaceManager)

declare global {
  interface HTMLElementTagNameMap {
    'space-manager': SpaceManager
  }
}
