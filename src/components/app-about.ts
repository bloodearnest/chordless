import { css, html, LitElement } from 'lit'
import { AppUpdateChangeEvent, appUpdate } from '../js/app-update.ts'
import {
  currentInstallMode,
  INSTALL_CHANGE_EVENT,
  type InstallMode,
  promptInstall,
} from '../js/install.ts'
import { buttonStyles, panelStyles, statusStyles } from './shared-styles.ts'
import { renderStatus, type StatusShown } from './status-view.ts'
import './why-install.ts'

/** What the browser says of the device's storage for this app */
interface StorageInfo {
  persisted: boolean | null
  usage: number | null
}

/**
 * AppAbout
 *
 * The app's housekeeping, one panel for each: which version is running and whether a new one
 * is ready, whether it is installed, whether it will open offline, and whether the browser
 * will keep this device's songs and setlists or may clear them to make room.
 */
export class AppAbout extends LitElement {
  static override properties = {
    _installMode: { state: true },
    _running: { state: true },
    _offline: { state: true },
    _storage: { state: true },
    _now: { state: true },
  }

  declare _installMode: InstallMode
  declare _running: { version: string; released: string } | null
  declare _offline: boolean | null
  declare _storage: StorageInfo | null
  declare _now: number

  static override styles = [
    panelStyles,
    buttonStyles,
    statusStyles,
    css`
      :host {
        display: block;
      }

      .about-content {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .version-line {
        font-size: var(--font-ui-small);
        opacity: 0.75;
        margin: 0 0 0.5rem;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
    `,
  ]

  constructor() {
    super()
    this._installMode = currentInstallMode()
    this._running = null
    this._offline = null
    this._storage = null
    this._now = Date.now()
  }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener(AppUpdateChangeEvent.type, this._refresh)
    window.addEventListener(INSTALL_CHANGE_EVENT, this._refreshInstall)
    void this._load()
  }

  override disconnectedCallback() {
    window.removeEventListener(AppUpdateChangeEvent.type, this._refresh)
    window.removeEventListener(INSTALL_CHANGE_EVENT, this._refreshInstall)
    super.disconnectedCallback()
  }

  _refresh = (): void => {
    this._now = Date.now()
    // The update controller's state changed, which the timestamp alone may not show
    this.requestUpdate()
  }

  _refreshInstall = (): void => {
    this._installMode = currentInstallMode()
  }

  async _load(): Promise<void> {
    this._running = await appUpdate.runningVersion()
    // Offline use needs this version's files saved: the worker's own copy of them
    try {
      this._offline = this._running ? await caches.has(`cache-${this._running.version}`) : false
    } catch {
      this._offline = null
    }
    await this._loadStorage()
  }

  async _loadStorage(): Promise<void> {
    const storage = navigator.storage
    if (!storage) {
      this._storage = { persisted: null, usage: null }
      return
    }
    const [persisted, estimate] = await Promise.all([
      storage.persisted?.().catch(() => null) ?? null,
      storage.estimate?.().catch(() => null) ?? null,
    ])
    this._storage = {
      persisted,
      usage: estimate?.usage ?? null,
    }
  }

  // ==================== What each panel shows ====================

  _updateStatus(): StatusShown & { state: string } {
    if (appUpdate.ready) {
      return {
        state: 'ready',
        look: 'warn',
        icon: 'refresh',
        label: 'Update ready',
        detail: 'A new version is saved on this device. Reload to use it.',
      }
    }
    if (appUpdate.installing) {
      return {
        state: 'installing',
        look: 'warn',
        icon: 'clock',
        label: 'Getting the update',
        detail: 'A new version is being saved on this device.',
      }
    }
    if (appUpdate.checking) {
      return {
        state: 'checking',
        look: 'none',
        icon: 'clock',
        label: 'Checking',
        detail: 'Looking for a new version.',
      }
    }
    if (appUpdate.failed) {
      return {
        state: 'failed',
        look: 'bad',
        icon: 'warning',
        label: "Couldn't check",
        detail:
          "The server couldn't be reached. Are you offline? It tries again from time to time.",
      }
    }
    if (!appUpdate.available) {
      return {
        state: 'none',
        look: 'none',
        icon: 'ban',
        label: 'No updates here',
        detail: "This browser isn't keeping the app's files, so every visit loads the latest.",
      }
    }
    return {
      state: 'current',
      look: 'good',
      icon: 'check',
      label: 'Up to date',
      detail: appUpdate.lastChecked
        ? `Checked ${this._ago(appUpdate.lastChecked)}.`
        : 'It checks when you open the app, and now and then while it is open.',
    }
  }

  /** "just now", "5 minutes ago", "2 hours ago" */
  _ago(time: number): string {
    const minutes = Math.floor((this._now - time) / 60_000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
    const hours = Math.floor(minutes / 60)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }

  _offlineStatus(): StatusShown & { state: string } {
    if (this._offline === null || !navigator.serviceWorker) {
      return {
        state: 'none',
        look: 'none',
        icon: 'ban',
        label: 'Not offline',
        detail: "This browser can't save the app for offline use.",
      }
    }
    return this._offline
      ? {
          state: 'ready',
          look: 'good',
          icon: 'check',
          label: 'Ready offline',
          detail: 'The whole app is saved on this device, so it opens without a connection.',
        }
      : {
          state: 'not-yet',
          look: 'warn',
          icon: 'clock',
          label: 'Not yet',
          detail: 'Reload the app once, so it can save itself for offline use.',
        }
  }

  _installStatus(): StatusShown & { state: string } {
    switch (this._installMode) {
      case 'installed':
        return {
          state: 'installed',
          look: 'good',
          icon: 'check',
          label: 'Installed',
          detail: 'Running as an installed app.',
        }
      case 'prompt':
        return {
          state: 'prompt',
          look: 'none',
          icon: 'add',
          label: 'Not installed',
          detail: 'Install it to open full screen and keep its data safe.',
        }
      case 'ios':
        return {
          state: 'ios',
          look: 'none',
          icon: 'add',
          label: 'Not installed',
          detail:
            'Tap the Share button, then Add to Home Screen. The installed app keeps its own data, so you will sign in again in it.',
        }
      case 'mac-safari':
        return {
          state: 'mac-safari',
          look: 'none',
          icon: 'add',
          label: 'Not installed',
          detail: 'In the menu bar, choose File, then Add to Dock.',
        }
      default:
        return {
          state: 'none',
          look: 'none',
          icon: 'ban',
          label: "Can't install here",
          detail: 'This browser has no way to install the app.',
        }
    }
  }

  _storageStatus(): StatusShown & { state: string } {
    const info = this._storage
    // Only what is used: the quota a browser reports is not the real limit (Chrome says 10 GB
    // more than is used, whatever the disk), and this app uses megabytes
    const usage = info?.usage != null ? ` Using ${this._size(info.usage)}.` : ''
    if (info?.persisted) {
      return {
        state: 'persistent',
        look: 'good',
        icon: 'check',
        label: 'Protected',
        detail: `The browser will not clear this app's songs and setlists to make room.${usage}`,
      }
    }
    if (info?.persisted === false) {
      return {
        state: 'best-effort',
        look: 'warn',
        icon: 'warning',
        label: 'Not protected',
        detail: `The browser may clear this app's data if the device runs short of room. Installing the app helps.${usage}`,
      }
    }
    return {
      state: 'unknown',
      look: 'none',
      icon: 'ban',
      label: 'Unknown',
      detail: "This browser can't say whether it will keep this app's data.",
    }
  }

  /** "Version abc123, released 12 October 2026" */
  _versionLine(): string {
    const running = this._running
    if (!running) return 'Version unknown'
    const date = running.released ? new Date(running.released) : null
    const released =
      date && !Number.isNaN(date.getTime())
        ? `, released ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`
        : ''
    return `Version ${running.version}${released}`
  }

  /** A size in words: "3.2 MB", "24 GB" */
  _size(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unit = 0
    while (value >= 1000 && unit < units.length - 1) {
      value /= 1000
      unit++
    }
    return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
  }

  // ==================== Actions ====================

  async _checkNow(): Promise<void> {
    await appUpdate.check({ force: true })
    this._now = Date.now()
  }

  async _install(): Promise<void> {
    await promptInstall()
    this._installMode = currentInstallMode()
  }

  async _protect(): Promise<void> {
    try {
      await navigator.storage.persist()
    } catch (error) {
      console.warn('[About] Persistent storage request failed:', error)
    }
    await this._loadStorage()
  }

  // ==================== Render ====================

  override render() {
    const update = this._updateStatus()
    const offline = this._offlineStatus()
    const install = this._installStatus()
    const storage = this._storageStatus()
    return html`
      <div class="about-content">
        <div class="panel">
          <h3>Version</h3>
          <p class="version-line" id="app-version">
            ${this._versionLine()}
          </p>
          ${renderStatus(update, { id: 'update-status', state: update.state })}
          <div class="actions">
            ${
              appUpdate.ready
                ? html`<button class="btn primary" type="button" @click=${() => appUpdate.apply()}>
                  Reload now
                </button>`
                : html`<button
                  class="btn"
                  type="button"
                  ?disabled=${appUpdate.checking || appUpdate.installing || !appUpdate.available}
                  @click=${this._checkNow}
                >
                  Check for updates
                </button>`
            }
          </div>
        </div>

        <div class="panel">
          <h3>Offline</h3>
          ${renderStatus(offline, { id: 'offline-status', state: offline.state })}
        </div>

        <div class="panel">
          <h3>Install</h3>
          ${renderStatus(install, { id: 'install-status', state: install.state })}
          <p><why-install></why-install></p>
          ${
            this._installMode === 'prompt'
              ? html`<div class="actions">
                <button class="btn primary" type="button" @click=${this._install}>
                  Install Chordless
                </button>
              </div>`
              : ''
          }
        </div>

        <div class="panel">
          <h3>Storage on this device</h3>
          ${renderStatus(storage, { id: 'storage-status', state: storage.state })}
          ${
            this._storage?.persisted === false
              ? html`<div class="actions">
                <button class="btn" type="button" @click=${this._protect}>
                  Ask the browser to keep it
                </button>
              </div>`
              : ''
          }
        </div>
      </div>
    `
  }
}

customElements.define('app-about', AppAbout)

declare global {
  interface HTMLElementTagNameMap {
    'app-about': AppAbout
  }
}
