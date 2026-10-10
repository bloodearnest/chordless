import { Task } from '@lit/task'
import { css, html, LitElement } from 'lit'

/**
 * storage-summary
 *
 * Displays counts of local setlists/songs plus storage usage estimates
 * for IndexedDB and Service Worker caches.
 */
/** Counts and sizes of what is stored in this browser */
interface StorageStats {
  setlists: number
  songs: number
  dbBytes: number
  appCacheBytes: number | null
  mediaCacheBytes: number | null
}

export class StorageSummary extends LitElement {
  _stats: Task<[], StorageStats>
  static override styles = css`
    :host {
      display: block;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 0.75rem;
    }

    .stat-card {
      background: var(--tint);
      border-radius: 8px;
      padding: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .stat-label {
      font-size: var(--font-ui-small);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.75;
    }

    .stat-value {
      font-size: var(--font-ui);
      font-weight: 700;
    }

    .stat-list {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      margin-top: 0.25rem;
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      font-size: var(--font-ui-small);
      font-weight: 600;
    }

    .stat-subtext {
      font-size: var(--font-ui-small);
      opacity: 0.7;
    }

    .footnote {
      margin-top: 0.75rem;
      font-size: var(--font-ui-small);
      opacity: 0.65;
    }

    .error-card {
      padding: 1rem;
      border-radius: 8px;
      background: color-mix(in srgb, var(--color-danger, #e74c3c) 15%, transparent);
      border: 1px solid color-mix(in srgb, var(--color-danger, #e74c3c) 40%, transparent);
    }
  `

  constructor() {
    super()
    // Counts and sizes of what's stored in this browser, loaded when first rendered
    this._stats = new Task(this, {
      task: () => this._loadStats(),
      args: () => [],
      onError: error => console.error('[StorageSummary] Failed to load storage stats', error),
    })
  }

  override render() {
    const loading = () => html`
      <div class="stat-card">
        <span class="stat-label">Loading…</span>
        <span class="stat-value">–</span>
      </div>
    `
    return this._stats.render({
      initial: loading,
      pending: loading,
      complete: stats => this._renderStats(stats),
      error: () => html`<div class="error-card">Unable to read local storage details.</div>`,
    })
  }

  _renderStats(stats: StorageStats) {
    return html`
      <div class="summary-grid">
        ${this._renderListStat('Setlists & Songs', [
          { label: 'Setlists', value: stats.setlists },
          { label: 'Songs', value: stats.songs },
        ])}
        ${this._renderListStat('Storage Usage', [
          { label: 'DB', value: this._formatBytes(stats.dbBytes) },
          { label: 'App Cache', value: this._formatMegabytes(stats.appCacheBytes) },
          { label: 'Media Cache', value: this._formatBytes(stats.mediaCacheBytes) },
        ])}
      </div>
      <p class="footnote">Includes data stored in this browser only.</p>
    `
  }

  _renderListStat(label: string, rows: { label: string; value: string | number | null }[]) {
    return html`
      <div class="stat-card">
        <span class="stat-label">${label}</span>
        <div class="stat-list">
          ${rows.map(
            row => html`
              <div class="stat-row">
                <span>${row.label}</span>
                <span>${row.value ?? '–'}</span>
              </div>
            `
          )}
        </div>
      </div>
    `
  }

  /** Counts and sizes of the setlists, songs and caches stored in this browser */
  async _loadStats(): Promise<StorageStats> {
    const { getCurrentDB } = await import('../js/db.ts')
    const db = await getCurrentDB()

    const [setlists, songs] = await Promise.all([db.getAllSetlists(), db.getAllSongs()])

    const [dbBytesFromEstimate, cacheUsage] = await Promise.all([
      this._estimateIndexedDbUsage(),
      this._estimateCacheUsage(),
    ])

    const approxDataBytes =
      dbBytesFromEstimate ?? estimateRecordsSize(setlists) + estimateRecordsSize(songs)

    return {
      setlists: setlists.length,
      songs: songs.length,
      dbBytes: approxDataBytes,
      appCacheBytes: cacheUsage?.appBytes ?? null,
      mediaCacheBytes: cacheUsage?.mediaBytes ?? null,
    }
  }

  async _estimateIndexedDbUsage(): Promise<number | null> {
    if (navigator.storage?.estimate) {
      try {
        // usageDetails is not in the standard, but Chromium has it
        const estimate: StorageEstimate & { usageDetails?: { indexedDB?: number } } =
          await navigator.storage.estimate()
        if (estimate?.usageDetails?.indexedDB) {
          return estimate.usageDetails.indexedDB
        }
      } catch (error) {
        console.warn('[StorageSummary] StorageManager estimate failed', error)
      }
    }
    return null
  }

  async _estimateCacheUsage(): Promise<{ appBytes: number; mediaBytes: number } | null> {
    if (typeof caches === 'undefined') {
      return null
    }

    try {
      const cacheNames = await caches.keys()
      let appBytes = 0
      let mediaBytes = 0

      for (const name of cacheNames) {
        const cache = await caches.open(name)
        const requests = await cache.keys()

        for (const request of requests) {
          const response = await cache.match(request)
          if (!response) continue
          const buffer = await response.clone().arrayBuffer()
          if (isMediaRequest(request)) {
            mediaBytes += buffer.byteLength
          } else {
            appBytes += buffer.byteLength
          }
        }
      }

      return { appBytes, mediaBytes }
    } catch (error) {
      console.warn('[StorageSummary] Failed to inspect caches', error)
      return null
    }
  }

  _formatBytes(bytes: number | null): string {
    if (bytes == null) {
      return '–'
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unitIndex = 0

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024
      unitIndex++
    }

    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
  }

  _formatMegabytes(bytes: number | null): string {
    if (bytes == null) {
      return '–'
    }
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`
  }
}

function estimateRecordsSize(records: unknown): number {
  if (!records) return 0
  try {
    const json = JSON.stringify(records)
    return new Blob([json]).size
  } catch (error) {
    console.warn('[StorageSummary] Failed to measure record size', error)
    return 0
  }
}

const MEDIA_EXTENSIONS = new Set(['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'])

function isMediaRequest(request: Request): boolean {
  try {
    const url = new URL(request.url)
    const pathname = url.pathname || ''
    const lastSegment = pathname.split('/').pop() || ''
    const ext = lastSegment.includes('.') ? (lastSegment.split('.').pop() ?? '').toLowerCase() : ''

    if (!ext) {
      // Treat extensionless requests as app assets (HTML routes, etc.)
      return false
    }

    return MEDIA_EXTENSIONS.has(ext)
  } catch (error) {
    console.warn('[StorageSummary] Failed to classify cache entry', error)
    return false
  }
}

customElements.define('storage-summary', StorageSummary)

declare global {
  interface HTMLElementTagNameMap {
    'storage-summary': StorageSummary
  }
}
