import { css, html, LitElement, nothing } from 'lit'
import type { Space } from '../js/data-types.ts'
import { driveApi } from '../js/drive-api.ts'
import { type PickedFolder, pickFolder } from '../js/folder-picker.ts'
import {
  authorizeWithGoogle,
  connectDrive,
  getSignInState,
  type SignInState,
} from '../js/google-auth.ts'
import { switchSpace } from '../js/space.ts'
import { createTeamSpace, type TeamFolders } from '../js/team-spaces.ts'
import { errorMessage } from '../js/utils/errors.ts'
import { buttonStyles } from './shared-styles.ts'

type State = 'checking' | 'sign-in' | 'form' | 'creating' | 'created'

/**
 * Make a team space (docs/SPACES.md, "Creating a team space"): its name, and the folder in Drive
 * that it will be made in, My Drive or a shared drive. A new space, in a folder of its own: a
 * personal space is never turned into one. Bringing songs across and inviting people come next.
 */
export class TeamSpaceWizard extends LitElement {
  static override properties = {
    _state: { state: true },
    _name: { state: true },
    _parent: { state: true },
    _message: { state: true },
    _created: { state: true },
  }

  declare _state: State
  declare _name: string
  declare _parent: PickedFolder | null
  /** What went wrong, if something did */
  declare _message: string
  declare _created: Space | null
  declare _signIn: SignInState

  /** The folder chooser, Drive, and starting the app afresh in the new space (tests give their own) */
  pick: () => Promise<PickedFolder | null> = () => pickFolder()
  folders: TeamFolders = driveApi
  /* v8 ignore next 3 -- reloading the page would end the test run: tests give their own */
  // biome-ignore lint/plugin: the database is another space's now, so start afresh
  reload: () => void = () => window.location.assign('/')

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
  }

  override connectedCallback(): void {
    super.connectedCallback()
    void this._check()
  }

  /** Whether they are signed in with Drive: the folder is made with their own access */
  async _check(): Promise<void> {
    this._signIn = await getSignInState()
    this._state = this._signIn === 'signed-in' ? 'form' : 'sign-in'
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
    this._message = ''
    this._state = 'creating'
    try {
      this._created = await createTeamSpace(this._name, this._parent.id, this.folders)
      this._state = 'created'
    } catch (error) {
      this._message = errorMessage(error)
      this._state = 'form'
    }
  }

  /** The space is on this device: start the app afresh in it */
  _open(): void {
    if (this._created) void switchSpace(this._created.id, this.reload)
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
            It is a new space with its own folder in Google Drive. Open it to add songs, then invite
            your team from the Storage page.
          </p>
          <div class="actions">
            <button class="btn primary" @click=${this._open}>Open ${this._created?.name}</button>
          </div>
        `
    }
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
          in Drive. A folder in your own Drive works too. Chordless makes a folder named for the team
          inside the one you choose.
        </p>
        ${this._message ? html`<p class="status error" role="alert">${this._message}</p>` : nothing}
        <div class="actions">
          <button
            type="submit"
            class="btn primary"
            ?disabled=${busy || !this._name.trim() || !this._parent}
          >
            ${busy ? 'Creating…' : 'Create team space'}
          </button>
        </div>
      </form>
    `
  }
}
customElements.define('team-space-wizard', TeamSpaceWizard)

declare global {
  interface HTMLElementTagNameMap {
    'team-space-wizard': TeamSpaceWizard
  }
}
