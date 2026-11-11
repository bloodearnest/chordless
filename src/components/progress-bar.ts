import { css, html, LitElement } from 'lit'
import { ifDefined } from 'lit/directives/if-defined.js'

/**
 * A thin bar for how far something has got: `current` of `total`. With no total (or one that is
 * not above nothing) it does not know how far, and a short segment slides along instead of a
 * fraction being invented. Used wherever a sync is shown: the sync panel, and the pages that make
 * or join a team space, whose first sync can take a while.
 */
export class ProgressBar extends LitElement {
  static override properties = {
    current: { type: Number },
    total: { type: Number },
    label: { type: String },
  }

  declare current: number | undefined
  declare total: number | undefined
  /** What the bar is for, for someone who cannot see it */
  declare label: string

  static override styles = css`
    :host {
      display: block;
    }
    .bar {
      width: 100%;
      height: 4px;
      background: var(--tint);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 0.5rem;
    }
    .fill {
      height: 100%;
      background: var(--color-primary, #2477ad);
      transition: width 0.3s;
      border-radius: 2px;
    }
    .fill.unknown {
      width: 40%;
      transition: none;
      animation: slide 1.2s ease-in-out infinite;
    }
    @keyframes slide {
      from {
        margin-left: -40%;
      }
      to {
        margin-left: 100%;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .fill.unknown {
        animation: none;
        margin-left: 30%;
      }
    }
  `

  constructor() {
    super()
    this.label = 'Progress'
  }

  /** How far, 0 to 100, or null if it is not known */
  get percent(): number | null {
    const { current, total } = this
    if (typeof current !== 'number' || typeof total !== 'number' || !(total > 0)) return null
    return Math.max(0, Math.min(100, Math.round((current / total) * 100)))
  }

  override render() {
    const percent = this.percent
    return html`
      <div
        class="bar"
        role="progressbar"
        aria-label=${this.label}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${ifDefined(percent ?? undefined)}
      >
        <div
          class="fill ${percent === null ? 'unknown' : ''}"
          style=${ifDefined(percent === null ? undefined : `width: ${percent}%`)}
        ></div>
      </div>
    `
  }
}
customElements.define('progress-bar', ProgressBar)

declare global {
  interface HTMLElementTagNameMap {
    'progress-bar': ProgressBar
  }
}
