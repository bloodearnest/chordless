import { css, html, LitElement } from 'lit'
import { AppUpdateChangeEvent, appUpdate } from '../js/app-update.ts'
import {
  currentInstallMode,
  INSTALL_CHANGE_EVENT,
  type InstallMode,
  promptInstall,
} from '../js/install.ts'
import { type LaunchReport, launchReport } from '../js/storage-survival.ts'
import { t } from '../js/text.ts'
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
    _launch: { state: true },
    _now: { state: true },
  }

  declare _installMode: InstallMode
  declare _running: { version: string; released: string } | null
  declare _offline: boolean | null
  declare _storage: StorageInfo | null
  declare _launch: LaunchReport | null
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
    this._launch = null
    this._now = Date.now()
  }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener(AppUpdateChangeEvent.type, this._refresh)
    window.addEventListener(INSTALL_CHANGE_EVENT, this._refreshInstall)
    // On the first visit the worker takes control of a page that is already showing, and only
    // then can it say which version is running
    navigator.serviceWorker?.addEventListener('controllerchange', this._reload)
    void this._load()
  }

  override disconnectedCallback() {
    window.removeEventListener(AppUpdateChangeEvent.type, this._refresh)
    window.removeEventListener(INSTALL_CHANGE_EVENT, this._refreshInstall)
    navigator.serviceWorker?.removeEventListener('controllerchange', this._reload)
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

  _reload = (): void => {
    void this._load()
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
    this._launch = await launchReport().catch(() => null)
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
        label: t('about-update-ready'),
        detail: t('about-update-ready-detail'),
      }
    }
    if (appUpdate.installing) {
      return {
        state: 'installing',
        look: 'warn',
        icon: 'clock',
        label: t('about-update-getting'),
        detail: t('about-update-getting-detail'),
      }
    }
    if (appUpdate.checking) {
      return {
        state: 'checking',
        look: 'none',
        icon: 'clock',
        label: t('about-update-checking'),
        detail: t('about-update-checking-detail'),
      }
    }
    if (appUpdate.failed) {
      return {
        state: 'failed',
        look: 'bad',
        icon: 'warning',
        label: t('about-update-failed'),
        detail: t('about-update-failed-detail'),
      }
    }
    if (!appUpdate.available) {
      return {
        state: 'none',
        look: 'none',
        icon: 'ban',
        label: t('about-update-none-label'),
        detail: t('about-update-none-detail'),
      }
    }
    return {
      state: 'current',
      look: 'good',
      icon: 'check',
      label: t('about-update-current'),
      detail: appUpdate.lastChecked
        ? t('about-update-checked', { ago: this._ago(appUpdate.lastChecked) })
        : t('about-update-current-detail'),
    }
  }

  /** "just now", "5 minutes ago", "2 hours ago" */
  _ago(time: number): string {
    const minutes = Math.floor((this._now - time) / 60_000)
    if (minutes < 1) return t('ago-now')
    if (minutes < 60) return t('ago-minutes', { count: minutes })
    return t('ago-hours', { count: Math.floor(minutes / 60) })
  }

  _offlineStatus(): StatusShown & { state: string } {
    if (this._offline === null || !navigator.serviceWorker) {
      return {
        state: 'none',
        look: 'none',
        icon: 'ban',
        label: t('about-offline-none'),
        detail: t('about-offline-none-detail'),
      }
    }
    return this._offline
      ? {
          state: 'ready',
          look: 'good',
          icon: 'check',
          label: t('about-offline-ready'),
          detail: t('about-offline-ready-detail'),
        }
      : {
          state: 'not-yet',
          look: 'warn',
          icon: 'clock',
          label: t('about-offline-not-yet'),
          detail: t('about-offline-not-yet-detail'),
        }
  }

  _installStatus(): StatusShown & { state: string } {
    switch (this._installMode) {
      case 'installed':
        return {
          state: 'installed',
          look: 'good',
          icon: 'check',
          label: t('about-install-done'),
          detail: t('about-install-done-detail'),
        }
      case 'prompt':
        return {
          state: 'prompt',
          look: 'none',
          icon: 'add',
          label: t('about-install-not'),
          detail: t('about-install-not-detail'),
        }
      case 'ios':
        return {
          state: 'ios',
          look: 'none',
          icon: 'add',
          label: t('about-install-not'),
          detail: t('about-install-ios-detail'),
        }
      case 'mac-safari':
        return {
          state: 'mac-safari',
          look: 'none',
          icon: 'add',
          label: t('about-install-not'),
          detail: t('about-install-mac-detail'),
        }
      default:
        return {
          state: 'none',
          look: 'none',
          icon: 'ban',
          label: t('about-install-cannot'),
          detail: t('about-install-cannot-detail'),
        }
    }
  }

  _storageStatus(): StatusShown & { state: string } {
    const info = this._storage
    // Only what is used: the quota a browser reports is not the real limit (Chrome says 10 GB
    // more than is used, whatever the disk), and this app uses megabytes
    const usage =
      info?.usage != null ? ` ${t('about-storage-using', { size: this._size(info.usage) })}` : ''
    if (info?.persisted) {
      return {
        state: 'persistent',
        look: 'good',
        icon: 'check',
        label: t('about-storage-protected'),
        detail: `${t('about-storage-protected-detail')}${usage}`,
      }
    }
    if (info?.persisted === false) {
      return {
        state: 'best-effort',
        look: 'warn',
        icon: 'warning',
        label: t('about-storage-not-protected'),
        detail: `${t('about-storage-not-protected-detail')}${usage}`,
      }
    }
    return {
      state: 'unknown',
      look: 'none',
      icon: 'ban',
      label: t('about-storage-unknown'),
      detail: t('about-storage-unknown-detail'),
    }
  }

  /** Whether what the last launch left on this device was still there (src/js/storage-survival.ts) */
  _launchStatus(): StatusShown & { state: string } {
    const launch = this._launch
    const kept = launch ? [launch.localStorage, launch.indexedDb].filter(s => s === 'kept') : []
    if (!launch || [launch.localStorage, launch.indexedDb].every(s => s === 'unavailable')) {
      return {
        state: 'unknown',
        look: 'none',
        icon: 'ban',
        label: t('about-launch-unknown'),
        detail: t('about-launch-unknown-detail'),
      }
    }
    if (kept.length === 0) {
      return {
        state: 'first',
        look: 'warn',
        icon: 'warning',
        label: t('about-launch-first'),
        detail: t('about-launch-first-detail'),
      }
    }
    const lost = [
      launch.localStorage === 'new' ? t('about-launch-local') : '',
      launch.indexedDb === 'new' ? t('about-launch-database') : '',
    ].filter(Boolean)
    const first = new Date(launch.firstSeen).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    const history = t('about-launch-kept-detail', {
      count: launch.launches,
      date: first,
      ago: launch.previous ? this._ago(Date.parse(launch.previous)) : '',
    })
    if (lost.length > 0) {
      return {
        state: 'partial',
        look: 'bad',
        icon: 'warning',
        label: t('about-launch-partial'),
        detail: `${t('about-launch-partial-detail', { cleared: lost.join(', ') })} ${history}`,
      }
    }
    return {
      state: 'kept',
      look: 'good',
      icon: 'check',
      label: t('about-launch-kept'),
      detail: history,
    }
  }

  /** "Version abc123, released 12 October 2026" */
  _versionLine(): string {
    const running = this._running
    if (!running) return t('about-version-unknown')
    const date = running.released ? new Date(running.released) : null
    if (date && !Number.isNaN(date.getTime())) {
      return t('about-version-released', {
        version: running.version,
        date: date.toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
      })
    }
    return t('about-version', { version: running.version })
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
    const launch = this._launchStatus()
    return html`
      <div class="about-content">
        <div class="panel">
          <h3>${t('about-version-heading')}</h3>
          <p class="version-line" id="app-version">
            ${this._versionLine()}
          </p>
          ${renderStatus(update, { id: 'update-status', state: update.state })}
          <div class="actions">
            ${
              appUpdate.ready
                ? html`<button class="btn primary" type="button" @click=${() => appUpdate.apply()}>
                  ${t('about-reload-now')}
                </button>`
                : html`<button
                  class="btn"
                  type="button"
                  ?disabled=${appUpdate.checking || appUpdate.installing || !appUpdate.available}
                  @click=${this._checkNow}
                >
                  ${t('action-check-for-updates')}
                </button>`
            }
          </div>
        </div>

        <div class="panel">
          <h3>${t('about-offline-heading')}</h3>
          ${renderStatus(offline, { id: 'offline-status', state: offline.state })}
        </div>

        <div class="panel">
          <h3>${t('about-install-heading')}</h3>
          ${renderStatus(install, { id: 'install-status', state: install.state })}
          <p><why-install></why-install></p>
          ${
            this._installMode === 'prompt'
              ? html`<div class="actions">
                <button class="btn primary" type="button" @click=${this._install}>
                  ${t('about-install-button')}
                </button>
              </div>`
              : ''
          }
        </div>

        <div class="panel">
          <h3>${t('about-storage-heading')}</h3>
          ${renderStatus(storage, { id: 'storage-status', state: storage.state })}
          ${
            this._storage?.persisted === false
              ? html`<div class="actions">
                <button class="btn" type="button" @click=${this._protect}>
                  ${t('about-storage-protect')}
                </button>
              </div>`
              : ''
          }
        </div>

        <div class="panel">
          <h3>${t('about-launch-heading')}</h3>
          ${renderStatus(launch, { id: 'launch-status', state: launch.state })}
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
