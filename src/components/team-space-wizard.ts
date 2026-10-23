import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Space } from '../js/data-types.ts'
import { ChordlessDB } from '../js/db.ts'
import { driveApi } from '../js/drive-api.ts'
import { type PickedFolder, pickFolder } from '../js/folder-picker.ts'
import {
  authorizeWithGoogle,
  connectDrive,
  getCurrentUserInfo,
  getSignInState,
  type SignInState,
} from '../js/google-auth.ts'
import { withSource } from '../js/other-songs.ts'
import { getCurrentSpace, listSpaces, switchSpace } from '../js/space.ts'
import {
  type Bring,
  bringAcross,
  type Contents,
  contentsOf,
  type TransferReport,
} from '../js/space-transfer.ts'
import { isTeamMember } from '../js/storage/space-storage.ts'
import {
  createTeamSpace,
  type Leader,
  leadersOf,
  syncTeamSpace,
  type TeamFolders,
} from '../js/team-spaces.ts'
import { formatBytes } from '../js/utils/bytes.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles } from './shared-styles.ts'
import './team-invite-step.ts'

type State = 'checking' | 'sign-in' | 'form' | 'creating' | 'created'

/**
 * Make a team space (docs/SPACES.md, "Creating a team space"): its name, and the folder in Drive
 * that it will be made in, My Drive or a shared drive. A new space, in a folder of its own: a
 * personal space is never turned into one. It can bring the songs and setlists of a space on this
 * device across (copied, or for the setlists moved); inviting people comes next.
 */
export class TeamSpaceWizard extends LitElement {
  static override properties = {
    _state: { state: true },
    _name: { state: true },
    _parent: { state: true },
    _message: { state: true },
    _created: { state: true },
    _sources: { state: true },
    _sourceId: { state: true },
    _contents: { state: true },
    _songs: { state: true },
    _setlists: { state: true },
    _mode: { state: true },
    _report: { state: true },
    _bringError: { state: true },
    _syncError: { state: true },
    _stage: { state: true },
    _leaders: { state: true },
  }

  declare _state: State
  declare _name: string
  declare _parent: PickedFolder | null
  /** What went wrong, if something did */
  declare _message: string
  declare _created: Space | null
  declare _signIn: SignInState
  /** The spaces on this device that songs and setlists can be brought from */
  declare _sources: Space[]
  declare _sourceId: string
  /** What the chosen source holds, once counted */
  declare _contents: Contents | null
  declare _songs: boolean
  declare _setlists: boolean
  declare _mode: Bring['mode']
  /** What was brought across, once it has been */
  declare _report: TransferReport | null
  /** Why bringing them across did not work, if it did not */
  declare _bringError: string
  /** Why saving the new space to Google Drive did not work, if it did not */
  declare _syncError: string
  /** What is being done, while the space is being made */
  declare _stage: string
  /** The people the brought setlists name as leaders, to suggest inviting */
  declare _leaders: Leader[]
  /** What each of the sources holds */
  _counts: Map<string, Contents> = new Map()
  /** Where the work after the space is made has got to */
  _brought = false
  _saved = false
  _modal: Ref<AppModal> = createRef()

  /** The folder chooser and Drive (tests give their own) */
  pick: () => Promise<PickedFolder | null> = () => pickFolder()
  folders: TeamFolders = driveApi
  /** Saves the new space's songs and setlists to Drive for the team to get (a test gives its own) */
  syncSpace: (space: Space) => Promise<void> = syncTeamSpace
  /** Shows the space once it is the one in use (a test gives its own; by default the home page, afresh) */
  show: (() => unknown) | undefined = undefined

  static override styles = [
    buttonStyles,
    css`
    :host { display: block; flex: 1; min-height: 0; overflow-y: auto; color: var(--text-color); }
    .page { max-width: 600px; margin: 0 auto; padding: 2rem 1rem; }
    h2 { margin: 0 0 1rem; font-size: var(--font-ui); }
    label { display: block; font-weight: 600; margin: 1.25rem 0 0.4rem; }
    input { width: 100%; box-sizing: border-box; font: inherit; padding: 0.5rem; }
    .hint, .status { color: var(--text-secondary, #5f6b6d); }
    .status.error { color: var(--color-danger, #e74c3c); }
    .folder { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
    fieldset { margin: 1.5rem 0 0; padding: 0.75rem 1rem; border: 1px solid var(--border-color, #ccc); border-radius: 6px; }
    legend { font-weight: 600; padding: 0 0.4rem; }
    .check { display: flex; gap: 0.5rem; align-items: center; font-weight: normal; margin: 0.5rem 0; }
    .check input { width: auto; }
    .mode { margin-left: 1.5rem; }
    select { font: inherit; padding: 0.4rem; max-width: 100%; }
    .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 1.5rem; }
    `,
  ]

  constructor() {
    super()
    this._state = 'checking'
    this._name = ''
    this._parent = null
    this._message = ''
    this._created = null
    this._signIn = 'signed-out'
    this._sources = []
    this._sourceId = ''
    this._contents = null
    this._songs = true
    this._setlists = true
    this._mode = 'move'
    this._report = null
    this._bringError = ''
    this._syncError = ''
    this._stage = ''
    this._leaders = []
  }

  override connectedCallback(): void {
    super.connectedCallback()
    void this._check()
  }

  /** Whether they are signed in with Drive: the folder is made with their own access */
  async _check(): Promise<void> {
    this._signIn = await getSignInState()
    this._state = this._signIn === 'signed-in' ? 'form' : 'sign-in'
    if (this._state === 'form' && this._sources.length === 0) await this._findSources()
  }

  /** The spaces of this device that hold something to bring, the one in use first */
  async _findSources(): Promise<void> {
    const current = getCurrentSpace().id
    const spaces = (await listSpaces()).filter(space => !isTeamMember(space))
    spaces.sort((a, b) => Number(b.id === current) - Number(a.id === current))
    const counted = new Map<string, Contents>()
    const withSomething: Space[] = []
    for (const space of spaces) {
      const contents = await withSource(space.id, db => contentsOf(db))
      if (contents.songs.count === 0 && contents.setlists.count === 0) continue
      counted.set(space.id, contents)
      withSomething.push(space)
    }
    this._counts = counted
    this._sources = withSomething
    if (withSomething[0]) this._chooseSource(withSomething[0].id)
  }

  _chooseSource(id: string): void {
    this._sourceId = id
    this._contents = this._counts.get(id) as Contents
  }

  _pickSource(event: Event): void {
    this._chooseSource((event.target as HTMLSelectElement).value)
  }

  async _connect(): Promise<void> {
    this._message = ''
    try {
      if (this._signIn === 'no-drive') await connectDrive()
      else await authorizeWithGoogle()
    } catch (error) {
      this._message = errorMessage(error)
      return
    }
    await this._check()
  }

  async _choose(): Promise<void> {
    this._message = ''
    try {
      this._parent = (await this.pick()) ?? this._parent
    } catch (error) {
      this._message = errorMessage(error)
    }
  }

  _rename(event: Event): void {
    this._name = (event.target as HTMLInputElement).value
  }

  async _create(event?: Event): Promise<void> {
    event?.preventDefault()
    if (!this._name.trim() || !this._parent) return
    if (this._moves && !(await this._sureOfMove())) return
    this._message = ''
    this._stage = 'Making the space…'
    this._state = 'creating'
    try {
      this._created = await createTeamSpace(this._name, this._parent.id, this.folders)
    } catch (error) {
      this._message = errorMessage(error)
      this._state = 'form'
      return
    }
    // (the space is made: whatever goes wrong now can be tried again)
    await this._finish()
  }

  /**
   * What is left to do once the space is made: bring the songs and setlists across, then save them
   * to Drive so the team gets them when they join. Each is done once; this picks up where it stopped.
   */
  async _finish(): Promise<void> {
    this._state = 'creating'
    if (!this._brought) {
      this._stage = 'Bringing your songs and setlists across…'
      await this._bring()
    }
    if (this._brought && !this._saved) {
      this._stage = 'Saving to Google Drive…'
      await this._save()
    }
    this._state = 'created'
  }

  /** Put the new space's files in Drive (the first sync) */
  async _save(): Promise<void> {
    this._syncError = ''
    try {
      await this.syncSpace(this._created as Space)
      this._saved = true
    } catch (error) {
      this._syncError = errorMessage(error)
    }
  }

  /** What to bring across, as chosen (nothing if there is no source) */
  get _wanted(): Bring {
    return { songs: this._songs, setlists: this._setlists, mode: this._mode }
  }

  get _hasSomething(): boolean {
    const contents = this._contents
    return Boolean(contents && (contents.songs.count > 0 || contents.setlists.count > 0))
  }

  /** Whether the setlists will leave the source */
  get _moves(): boolean {
    const setlists = this._contents?.setlists.count ?? 0
    return setlists > 0 && this._setlists && this._mode === 'move'
  }

  async _sureOfMove(): Promise<boolean> {
    const count = (this._contents as Contents).setlists.count
    const modal = this._modal.value as AppModal
    modal.heading = 'Move the setlists?'
    modal.message = `${count} setlist${count === 1 ? '' : 's'} will move out of ${this._sourceName} into the team space. They will no longer be in ${this._sourceName}, only in the team's. Setlists already saved to Google Drive stay in ${this._sourceName} for now.`
    modal.confirmLabel = 'Move them'
    await this.updateComplete
    await modal.updateComplete
    return modal.ask()
  }

  get _sourceName(): string {
    return (this._sources.find(space => space.id === this._sourceId) as Space).name
  }

  /** Bring the chosen songs and setlists into the new space (again, if it did not work) */
  async _bring(): Promise<void> {
    const created = this._created
    if (!created || !this._hasSomething || !(this._songs || this._setlists)) {
      this._brought = true
      return
    }
    this._bringError = ''
    try {
      const destination = new ChordlessDB(created.id)
      await destination.init()
      try {
        this._report = await withSource(this._sourceId, source =>
          bringAcross(source, destination, this._wanted)
        )
        const own = (await getCurrentUserInfo())?.email
        this._leaders = leadersOf(await destination.getAllSetlists(), own)
        this._brought = true
      } finally {
        destination.db?.close()
      }
    } catch (error) {
      this._bringError = errorMessage(error)
    }
  }

  /** The space is on this device: start the app afresh in it */
  _open(): void {
    if (this._created) void switchSpace(this._created.id, this.show)
  }

  override render() {
    return html`<div class="page">${this._renderState()}</div>`
  }

  _renderState() {
    switch (this._state) {
      case 'checking':
        return html`<p class="status" role="status">Checking…</p>`
      case 'sign-in':
        return html`
          <h2>New team space</h2>
          <p>
            A team space keeps its songs and setlists in a folder in your Google Drive, so Chordless
            needs access to Drive to make it.
          </p>
          ${this._message ? html`<p class="status error" role="alert">${this._message}</p>` : nothing}
          <div class="actions">
            <button class="btn primary" @click=${this._connect}>
              ${this._signIn === 'no-drive' ? '📁 Connect Google Drive' : '🔑 Sign in with Google'}
            </button>
          </div>
        `
      case 'form':
      case 'creating':
        return this._renderForm()
      case 'created':
        return html`
          <h2>${this._created?.name} is ready</h2>
          <p>
            It is a new space with its own folder in Google Drive. ${this._reportText()}
          </p>
          ${
            this._bringError
              ? html`<p class="status error" role="alert">
                Couldn't bring your songs across: ${this._bringError}
              </p>`
              : nothing
          }
          ${
            this._syncError
              ? html`<p class="status error" role="alert">
                Couldn’t save it to Google Drive yet, so the team can’t get it: ${this._syncError}
              </p>`
              : nothing
          }
          ${
            this._bringError || this._syncError
              ? html`<div class="actions">
                <button class="btn" @click=${this._finish}>Try again</button>
              </div>`
              : nothing
          }
          <team-invite-step
            .team=${this._created?.team}
            .leaders=${this._leaders}
          ></team-invite-step>
          <div class="actions">
            <button class="btn primary" @click=${this._open}>Open ${this._created?.name}</button>
          </div>
        `
    }
  }

  /** What was brought across, in a sentence */
  _reportText(): string {
    const report = this._report
    if (!report) return ''
    const parts: string[] = []
    if (report.songsAdded)
      parts.push(`${report.songsAdded} song${report.songsAdded === 1 ? '' : 's'}`)
    if (report.setlistsAdded) {
      parts.push(`${report.setlistsAdded} setlist${report.setlistsAdded === 1 ? '' : 's'}`)
    }
    let text = parts.length ? `${parts.join(' and ')} came across. ` : 'Nothing new came across. '
    if (report.setlistsLeftInSource) {
      text += `${report.setlistsLeftInSource} setlist${report.setlistsLeftInSource === 1 ? ' is' : 's are'} also still in ${this._sourceName}, as they are saved to Google Drive. `
    }
    return text
  }

  _renderBring() {
    if (!this._hasSomething) return nothing
    const contents = this._contents as Contents
    const busy = this._state === 'creating'
    return html`
      <fieldset ?disabled=${busy}>
        <legend>Bring across</legend>
        ${
          this._sources.length > 1
            ? html`<label for="source">From</label>
              <select id="source" @change=${this._pickSource}>
                ${this._sources.map(
                  space => html`<option value=${space.id} ?selected=${space.id === this._sourceId}>
                    ${space.name}
                  </option>`
                )}
              </select>`
            : html`<p class="hint">From ${this._sourceName}</p>`
        }
        ${
          contents.songs.count > 0
            ? html`<label class="check">
              <input
                type="checkbox"
                id="songs"
                .checked=${this._songs}
                @change=${(event: Event) => {
                  this._songs = (event.target as HTMLInputElement).checked
                }}
              />
              Songs (${amount(contents.songs.count, contents.songs.bytes)}), copied
            </label>`
            : nothing
        }
        ${
          contents.setlists.count > 0
            ? html`<label class="check">
                <input
                  type="checkbox"
                  id="setlists"
                  .checked=${this._setlists}
                  @change=${(event: Event) => {
                    this._setlists = (event.target as HTMLInputElement).checked
                  }}
                />
                Setlists (${amount(contents.setlists.count, contents.setlists.bytes)}), with the songs they use
              </label>
              ${
                this._setlists
                  ? html`<div class="mode" role="radiogroup" aria-label="What happens to the setlists">
                    <label class="check">
                      <input
                        type="radio"
                        name="mode"
                        id="move"
                        .checked=${this._mode === 'move'}
                        @change=${() => {
                          this._mode = 'move'
                        }}
                      />
                      Move them: they leave ${this._sourceName}
                    </label>
                    <label class="check">
                      <input
                        type="radio"
                        name="mode"
                        id="copy"
                        .checked=${this._mode === 'copy'}
                        @change=${() => {
                          this._mode = 'copy'
                        }}
                      />
                      Keep a copy in ${this._sourceName}
                    </label>
                  </div>`
                  : nothing
              }`
            : nothing
        }
      </fieldset>
    `
  }

  _renderForm() {
    const busy = this._state === 'creating'
    return html`
      <h2>New team space</h2>
      <p class="hint">
        A new space for your team, separate from your personal space. Everyone you invite keeps its
        songs and setlists in step.
      </p>
      <form @submit=${this._create}>
        <label for="name">Team name</label>
        <input
          id="name"
          .value=${this._name}
          @input=${this._rename}
          ?disabled=${busy}
          placeholder="St Mary's Music"
          autocomplete="off"
          required
        />
        <label>Where to keep it in Google Drive</label>
        <div class="folder">
          <button type="button" class="btn" ?disabled=${busy} @click=${this._choose}>
            📁 ${this._parent ? 'Choose a different folder' : 'Choose a folder…'}
          </button>
          ${this._parent ? html`<span>${this._parent.name}</span>` : nothing}
        </div>
        <p class="hint">
          A shared drive is best: the files stay with the team if you leave, and everyone can see them
          in Drive. A folder in your own Drive works too. Chordless makes a folder inside the one you choose,
          named for the team, with “Chordless” after it.
        </p>
        ${this._renderBring()}
        ${this._message ? html`<p class="status error" role="alert">${this._message}</p>` : nothing}
        <div class="actions">
          <button
            type="submit"
            class="btn primary"
            ?disabled=${busy || !this._name.trim() || !this._parent}
          >
            ${busy ? this._stage || 'Creating…' : 'Create team space'}
          </button>
        </div>
      </form>
      <app-modal ${ref(this._modal)} type="confirm" size="small"></app-modal>
    `
  }
}

/** "212, 640 KB" */
function amount(count: number, bytes: number): string {
  return `${count}, ${formatBytes(bytes)}`
}
customElements.define('team-space-wizard', TeamSpaceWizard)

declare global {
  interface HTMLElementTagNameMap {
    'team-space-wizard': TeamSpaceWizard
  }
}
