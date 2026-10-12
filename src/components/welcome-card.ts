import { css, html, LitElement, nothing } from 'lit'
import {
  currentInstallMode,
  INSTALL_CHANGE_EVENT,
  type InstallMode,
  promptInstall,
} from '../js/install.ts'
import { goTo } from '../js/navigation.ts'
import { errorMessage } from '../js/utils/errors.ts'
import { buttonStyles } from './shared-styles.ts'

/**
 * WelcomeCard
 *
 * What a new user sees on the home page instead of an empty list: what Chordless is, and the
 * next steps (try the samples, add songs, sign in, install it). The home page shows it only
 * while there are no setlists.
 */
export class WelcomeCard extends LitElement {
  static override properties = {
    _installMode: { state: true },
    _busy: { state: true },
    _error: { state: true },
  }

  declare _installMode: InstallMode
  declare _busy: boolean
  declare _error: string

  constructor() {
    super()
    this._installMode = currentInstallMode()
    this._busy = false
    this._error = ''
  }

  static override styles = [
    buttonStyles,
    css`
      :host {
        display: block;
        padding: 1.5rem 1rem 3rem;
        color: var(--text-color, #1a1a1a);
      }

      .welcome {
        max-width: 40rem;
        margin: 0 auto;
      }

      h2 {
        font-size: var(--font-ui);
        margin: 0 0 0.5rem;
      }

      .lead {
        font-size: var(--font-ui);
        margin: 0 0 1.5rem;
      }

      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 1rem;
      }

      li {
        background: var(--panel-bg, #f5f6f7);
        border-radius: 8px;
        padding: 1rem 1.25rem;
      }

      h3 {
        font-size: var(--font-ui);
        margin: 0 0 0.4rem;
      }

      p {
        font-size: var(--font-ui-small);
        line-height: 1.5;
        margin: 0 0 0.75rem;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      a.btn {
        text-decoration: none;
      }

      .why {
        opacity: 0.8;
      }

      .error {
        color: var(--color-danger, #e74c3c);
      }
    `,
  ]

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener(INSTALL_CHANGE_EVENT, this._refreshInstallMode)
  }

  override disconnectedCallback() {
    window.removeEventListener(INSTALL_CHANGE_EVENT, this._refreshInstallMode)
    super.disconnectedCallback()
  }

  _refreshInstallMode = (): void => {
    this._installMode = currentInstallMode()
  }

  async _addSamples(): Promise<void> {
    this._busy = true
    this._error = ''
    try {
      const { addSampleSetlist } = await import('../js/samples.ts')
      await goTo(`/setlist/${await addSampleSetlist()}`)
    } catch (error) {
      console.error('Failed to add the sample setlist:', error)
      this._error = `Could not add the sample setlist: ${errorMessage(error)}`
    } finally {
      this._busy = false
    }
  }

  async _install(): Promise<void> {
    await promptInstall()
    this._installMode = currentInstallMode()
  }

  _renderInstall() {
    const mode = this._installMode
    if (mode === 'installed' || mode === 'none') return nothing

    const separateData =
      mode === 'prompt'
        ? nothing
        : html` The installed app keeps its own data, separate from Safari's, so you will
            need to sign in again in it.`

    return html`
      <li id="welcome-install">
        <h3>Install it</h3>
        <p class="why">
          Browsers can clear the saved data of a website that has not been used for a while: Safari
          does after about a week. An installed app is kept, opens full screen, and works offline,
          so your songs are there when you need them.${separateData}
        </p>
        ${
          mode === 'prompt'
            ? html`<div class="actions">
                <button class="btn" @click=${this._install}>Install Chordless</button>
              </div>`
            : mode === 'ios'
              ? html`<p>
                  Tap the <strong>Share</strong> button in your browser, then choose
                  <strong>Add to Home Screen</strong>.
                </p>`
              : html`<p>In the menu bar, choose <strong>File</strong>, then <strong>Add to Dock</strong>.</p>`
        }
      </li>
    `
  }

  override render() {
    return html`
      <section class="welcome" aria-labelledby="welcome-title">
        <h2 id="welcome-title">Welcome to Chordless</h2>
        <p class="lead">
          Chordless shows the lyrics and chords of your worship songs, arranged into a setlist for
          each service. It works offline, so it is ready even when the wifi is not.
        </p>
        <ol>
          <li id="welcome-samples">
            <h3>Try it</h3>
            <p>Add a sample setlist of four public-domain hymns, to see how it works.</p>
            <div class="actions">
              <button class="btn primary" ?disabled=${this._busy} @click=${this._addSamples}>
                Add a sample setlist
              </button>
            </div>
            ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
          </li>
          <li id="welcome-songs">
            <h3>Add your own songs</h3>
            <p>
              Import ChordPro files, or paste the text of a song. If your church has a CCLI licence,
              the SongSelect bookmarklet adds songs straight from SongSelect.
            </p>
            <div class="actions">
              <a class="btn" href="/import-song">Import songs</a>
              <a class="btn" href="/bookmarklet">SongSelect bookmarklet</a>
            </div>
          </li>
          <li id="welcome-sign-in">
            <h3>Keep them safe</h3>
            <p>
              Sign in with Google to keep your songs and setlists in your own Google Drive, and to
              share them between your devices.
            </p>
            <div class="actions"><a class="btn" href="/storage">Sign in and sync</a></div>
          </li>
          ${this._renderInstall()}
        </ol>
      </section>
    `
  }
}
customElements.define('welcome-card', WelcomeCard)

declare global {
  interface HTMLElementTagNameMap {
    'welcome-card': WelcomeCard
  }
}
