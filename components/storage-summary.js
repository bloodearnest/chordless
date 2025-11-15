import { LitElement, html, css } from 'lit';
import { SetalightDB } from '../js/db.js';
import { getCurrentOrganisation } from '../js/workspace.js';
import { getGlobalSongsDB } from '../js/songs-db.js';

/**
 * storage-summary
 *
 * Displays counts of local setlists/songs plus storage usage estimates
 * for IndexedDB and Service Worker caches.
 */
export class StorageSummary extends LitElement {
  static properties = {
    loading: { type: Boolean },
    error: { type: String },
    stats: { type: Object },
  };

  static styles = css`
    :host {
      display: block;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 0.75rem;
    }

    .stat-card {
      background: rgba(0, 0, 0, 0.15);
      border-radius: 8px;
      padding: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .stat-label {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.75;
    }

    .stat-value {
      font-size: 1.8rem;
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
      font-size: 1.2rem;
      font-weight: 600;
    }

    .stat-subtext {
      font-size: 0.85rem;
      opacity: 0.7;
    }

    .footnote {
      margin-top: 0.75rem;
      font-size: 0.75rem;
      opacity: 0.65;
    }

    .error-card {
      padding: 1rem;
      border-radius: 8px;
      background: rgba(231, 76, 60, 0.2);
      border: 1px solid rgba(231, 76, 60, 0.4);
    }
  `;

  constructor() {
    super();
    this.loading = true;
    this.error = null;
    this.stats = null;
    this._isMounted = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._isMounted = true;
    this._loadStats();
  }

  disconnectedCallback() {
    this._isMounted = false;
    super.disconnectedCallback();
  }

  render() {
    if (this.error) {
      return html`<div class="error-card">${this.error}</div>`;
    }

    if (this.loading || !this.stats) {
      return html`
        <div class="stat-card">
          <span class="stat-label">Loading…</span>
          <span class="stat-value">–</span>
        </div>
      `;
    }

    return html`
      <div class="summary-grid">
        ${this._renderListStat('Setlists & Songs', [
          { label: 'Setlists', value: this.stats.setlists },
          { label: 'Songs', value: this.stats.songs },
        ])}
        ${this._renderListStat('Storage Usage', [
          { label: 'DB', value: this._formatBytes(this.stats.dbBytes) },
          { label: 'App Cache', value: this._formatMegabytes(this.stats.appCacheBytes) },
          { label: 'Media Cache', value: this._formatBytes(this.stats.mediaCacheBytes) },
        ])}
      </div>
      <p class="footnote">Includes data stored in this browser only.</p>
    `;
  }

  _renderStat(label, value) {
    return html`
      <div class="stat-card">
        <span class="stat-label">${label}</span>
        <span class="stat-value">${value ?? '–'}</span>
      </div>
    `;
  }

  _renderListStat(label, rows) {
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
    `;
  }

  async _loadStats() {
    try {
      const organisation = getCurrentOrganisation();
      const setlistDb = new SetalightDB(organisation);
      await setlistDb.init();

      const songsDb = await getGlobalSongsDB();

      const [setlists, songs] = await Promise.all([
        setlistDb.getAllSetlists(),
        songsDb.getAllSongs(),
      ]);

      const [dbBytesFromEstimate, cacheUsage] = await Promise.all([
        this._estimateIndexedDbUsage(),
        this._estimateCacheUsage(),
      ]);

      const approxDataBytes =
        dbBytesFromEstimate ?? estimateRecordsSize(setlists) + estimateRecordsSize(songs);

      if (!this._isMounted) return;

      this.stats = {
        setlists: setlists.length,
        songs: songs.length,
        dbBytes: approxDataBytes,
        appCacheBytes: cacheUsage?.appBytes ?? null,
        mediaCacheBytes: cacheUsage?.mediaBytes ?? null,
      };
      this.loading = false;
    } catch (error) {
      console.error('[StorageSummary] Failed to load storage stats', error);
      if (!this._isMounted) return;
      this.error = 'Unable to read local storage details.';
      this.loading = false;
    }
  }

  async _estimateIndexedDbUsage() {
    if (navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        if (estimate?.usageDetails?.indexedDB) {
          return estimate.usageDetails.indexedDB;
        }
      } catch (error) {
        console.warn('[StorageSummary] StorageManager estimate failed', error);
      }
    }
    return null;
  }

  async _estimateCacheUsage() {
    if (typeof caches === 'undefined') {
      return null;
    }

    try {
      const cacheNames = await caches.keys();
      let appBytes = 0;
      let mediaBytes = 0;

      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const requests = await cache.keys();

        for (const request of requests) {
          const response = await cache.match(request);
          if (!response) continue;
          const buffer = await response.clone().arrayBuffer();
          if (isMediaRequest(request)) {
            mediaBytes += buffer.byteLength;
          } else {
            appBytes += buffer.byteLength;
          }
        }
      }

      return { appBytes, mediaBytes };
    } catch (error) {
      console.warn('[StorageSummary] Failed to inspect caches', error);
      return null;
    }
  }

  _formatBytes(bytes) {
    if (bytes == null) {
      return '–';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  _formatMegabytes(bytes) {
    if (bytes == null) {
      return '–';
    }
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  }
}

function estimateRecordsSize(records) {
  if (!records) return 0;
  try {
    const json = JSON.stringify(records);
    return new Blob([json]).size;
  } catch (error) {
    console.warn('[StorageSummary] Failed to measure record size', error);
    return 0;
  }
}

const MEDIA_EXTENSIONS = new Set(['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac']);

function isMediaRequest(request) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname || '';
    const lastSegment = pathname.split('/').pop() || '';
    const ext = lastSegment.includes('.') ? lastSegment.split('.').pop().toLowerCase() : '';

    if (!ext) {
      // Treat extensionless requests as app assets (HTML routes, etc.)
      return false;
    }

    return MEDIA_EXTENSIONS.has(ext);
  } catch (error) {
    console.warn('[StorageSummary] Failed to classify cache entry', error);
    return false;
  }
}

customElements.define('storage-summary', StorageSummary);
