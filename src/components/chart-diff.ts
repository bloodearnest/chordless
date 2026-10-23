import { css, html, LitElement, nothing } from 'lit'
import type { ParsedChart } from '../js/data-types.ts'
import { ChordProParser } from '../js/parser.ts'
import './song-display.ts'

/** Who and when a chart came from, to say beside its tab */
export interface ChartLabel {
  /** "In your library", "Importing" */
  heading: string
  /** "Imported by Jo, 3 Oct 2026, SongSelect": what is known */
  detail: string
}

/**
 * Two charts of a song, one at a time, full width, with a tab for each, each shown as the song
 * is everywhere else (chords over the words, in the app's theme and display preferences).
 *
 * Usage:
 *   <chart-diff .charts=${[mineText, theirsText]} .keys=${[keyA, keyB]} .labels=${[mine, theirs]}>
 *   </chart-diff>
 */
export class ChartDiff extends LitElement {
  static override properties = {
    charts: { attribute: false },
    keys: { attribute: false },
    labels: { attribute: false },
    _side: { state: true },
  }

  /** The ChordPro text of the two charts */
  declare charts: [string, string] | null
  /** The key each chart says it is in */
  declare keys: [string | null, string | null] | null
  declare labels: [ChartLabel, ChartLabel] | null
  declare _side: 0 | 1

  static override styles = css`
    :host {
      display: block;
      font-size: var(--font-ui-small, 0.85rem);
    }
    [role='tablist'] {
      display: flex;
      gap: 0.25rem;
      border-bottom: 2px solid var(--border-light, #ccc);
    }
    [role='tab'] {
      flex: 1;
      padding: 0.5rem 0.75rem;
      font: inherit;
      font-weight: 600;
      color: var(--text-secondary, #666);
      background: transparent;
      border: 2px solid transparent;
      border-bottom: none;
      border-radius: 6px 6px 0 0;
      cursor: pointer;
    }
    [role='tab'][aria-selected='true'] {
      color: var(--text-color, #222);
      background: var(--bg-secondary, #f8f9fa);
      border-color: var(--border-light, #ccc);
      margin-bottom: -2px;
    }
    .detail {
      margin: 0.5rem 0;
      color: var(--text-secondary, #666);
    }
  `

  constructor() {
    super()
    this.charts = null
    this.keys = null
    this.labels = null
    this._side = 0
  }

  override render() {
    const { charts, labels } = this
    if (!charts) return nothing
    const side = this._side
    const keys = this.keys ?? [null, null]
    return html`
      <div role="tablist" aria-label="Songs to compare" @keydown=${this._keydown}>
        ${([0, 1] as const).map(
          n => html`
            <button
              role="tab"
              id="tab-${n}"
              aria-selected=${side === n}
              aria-controls="panel"
              tabindex=${side === n ? 0 : -1}
              @click=${() => {
                this._side = n
              }}
            >
              ${labels?.[n].heading ?? ''}${keys[n] ? ` · key ${keys[n]}` : ''}
            </button>
          `
        )}
      </div>
      <div role="tabpanel" id="panel" aria-labelledby="tab-${side}">
        <p class="detail">${labels?.[side].detail ?? ''}</p>
        <song-display .parsed=${this._parsed(side)}></song-display>
      </div>
    `
  }

  /** A chart read as a song (once: the tabs are switched back and forth) */
  _parsed(side: 0 | 1): ParsedChart {
    const text = (this.charts as [string, string])[side]
    const cached = this._cache.get(text)
    if (cached) return cached
    const parsed = new ChordProParser().parse(text)
    this._cache.set(text, parsed)
    return parsed
  }

  _cache = new Map<string, ParsedChart>()

  /** Arrow keys move between the tabs */
  _keydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    this._side = this._side === 0 ? 1 : 0
    event.preventDefault()
    this.updateComplete.then(() =>
      this.shadowRoot?.querySelector<HTMLElement>(`#tab-${this._side}`)?.focus()
    )
  }
}

customElements.define('chart-diff', ChartDiff)

declare global {
  interface HTMLElementTagNameMap {
    'chart-diff': ChartDiff
  }
}
