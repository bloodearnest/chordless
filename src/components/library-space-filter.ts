import { css, html, LitElement, nothing } from 'lit'
import type { LibraryPlace } from '../js/library-spaces.ts'

/** The places left out of the library list changed */
export class LeftOutChangeEvent extends Event {
  static readonly type = 'library-space-filter:change'
  readonly leftOut: string[]
  constructor(leftOut: string[]) {
    super(LeftOutChangeEvent.type, { bubbles: true, composed: true })
    this.leftOut = leftOut
  }
}

/**
 * A bar over the library list with a toggle for each space the songs are from: all on to start with,
 * and a space switched off has its songs left out of the list. Nothing is drawn for one place, as
 * there is nothing to choose.
 *
 * @fires LeftOutChangeEvent - a place was switched on or off, with the ids now left out
 */
export class LibrarySpaceFilter extends LitElement {
  static override properties = {
    places: { attribute: false },
    leftOut: { attribute: false },
  }

  /** The places songs are from */
  declare places: LibraryPlace[]
  /** The ids of the places switched off */
  declare leftOut: string[]

  static override styles = css`
    :host {
      display: block;
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem;
      padding: 0.25rem 0 0.5rem;
      font-size: var(--font-ui-small, 0.85rem);
    }
    .label {
      opacity: 0.7;
      margin-right: 0.25rem;
    }
    button {
      font: inherit;
      padding: 0.2rem 0.7rem;
      border-radius: 999px;
      border: 1px solid var(--border-light, #ccc);
      background: transparent;
      color: var(--text-secondary, #666);
      cursor: pointer;
      text-decoration: line-through;
      opacity: 0.7;
    }
    button[aria-pressed='true'] {
      color: var(--text-color, #222);
      border-color: var(--color-primary, #2477ad);
      background: color-mix(in srgb, var(--color-primary, #2477ad) 12%, transparent);
      text-decoration: none;
      opacity: 1;
    }
  `

  constructor() {
    super()
    this.places = []
    this.leftOut = []
  }

  private _toggle(id: string): void {
    const leftOut = this.leftOut.includes(id)
      ? this.leftOut.filter(each => each !== id)
      : [...this.leftOut, id]
    this.dispatchEvent(new LeftOutChangeEvent(leftOut))
  }

  override render() {
    if (this.places.length < 2) return nothing
    return html`
      <div class="bar" role="group" aria-label="Spaces to search">
        <span class="label">Spaces:</span>
        ${this.places.map(
          place => html`<button
            type="button"
            data-place=${place.id}
            aria-pressed=${!this.leftOut.includes(place.id)}
            @click=${() => this._toggle(place.id)}
          >
            ${place.label}
          </button>`
        )}
      </div>
    `
  }
}
customElements.define('library-space-filter', LibrarySpaceFilter)

declare global {
  interface HTMLElementTagNameMap {
    'library-space-filter': LibrarySpaceFilter
  }
}
