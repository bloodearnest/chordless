import { css, html, LitElement, nothing } from 'lit'
import {
  currentInstallMode,
  INSTALL_CHANGE_EVENT,
  type InstallMode,
  promptInstall,
} from '../js/install.ts'
import { goTo } from '../js/navigation.ts'
import { rich } from '../js/rich-text.ts'
import { t } from '../js/text.ts'
import { errorMessage } from '../js/utils/errors.ts'
import { buttonStyles } from './shared-styles.ts'
import './why-install.ts'

/**
 * WelcomeCard
 *
 * What a new user sees on the home page instead of an empty list: what Chordless is, and the
 * next steps (try the samples, add songs, sign in, install it). The home page shows it only
 * while there are no setlists. How they read a song is asked once by <first-use-setup>.
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
      this._error = t('welcome-sample-failed', { reason: errorMessage(error) })
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

    const separateData = mode === 'prompt' ? '' : ` ${t('welcome-install-separate-data')}`

    return html`
      <li id="welcome-install">
        <h3>${t('welcome-install-heading')}</h3>
        <p class="why">
          ${t('welcome-install-text')}${separateData}
        </p>
        <p><why-install></why-install></p>
        ${
          mode === 'prompt'
            ? html`<div class="actions">
                <button class="btn" @click=${this._install}>${t('about-install-button')}</button>
              </div>`
            : mode === 'ios'
              ? html`<p>${rich('welcome-install-ios', undefined, { strong: words => html`<strong>${words}</strong>` })}</p>`
              : html`<p>${rich('welcome-install-mac', undefined, { strong: words => html`<strong>${words}</strong>` })}</p>`
        }
      </li>
    `
  }

  override render() {
    return html`
      <section class="welcome" aria-labelledby="welcome-title">
        <h2 id="welcome-title">${t('first-use-heading')}</h2>
        <p class="lead">${t('welcome-lead')}</p>
        <ol>
          <li id="welcome-samples">
            <h3>${t('welcome-samples-heading')}</h3>
            <p>${t('welcome-samples-text')}</p>
            <div class="actions">
              <button class="btn primary" ?disabled=${this._busy} @click=${this._addSamples}>
                ${t('welcome-samples-button')}
              </button>
            </div>
            ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
          </li>
          <li id="welcome-songs">
            <h3>${t('welcome-songs-heading')}</h3>
            <p>${t('welcome-songs-text')}</p>
            <div class="actions">
              <a class="btn" href="/import-song">${t('welcome-songs-button')}</a>
            </div>
          </li>
          <li id="welcome-sign-in">
            <h3>${t('welcome-safe-heading')}</h3>
            <p>${t('welcome-safe-text')}</p>
            <div class="actions"><a class="btn" href="/account">${t('welcome-safe-button')}</a></div>
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
