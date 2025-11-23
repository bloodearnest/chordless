import { css, html, LitElement } from 'lit'
import { unsafeSVG } from 'lit-html/directives/unsafe-svg.js'
import { icons } from '/js/icons.js'

/**
 * Icon Component
 *
 * Displays SVG icons from the icon library with consistent styling.
 *
 * Usage:
 *   <app-icon name="play"></app-icon>
 *   <app-icon name="settings" size="24"></app-icon>
 *
 * Properties:
 *   - name: Icon name from icons.js
 *   - size: Size in pixels (default: 24)
 */
export class Icon extends LitElement {
  static properties = {
    name: { type: String },
    size: { type: Number },
  }

  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      vertical-align: middle;
    }

    svg {
      display: block;
      fill: currentColor;
      width: var(--icon-size, 24px);
      height: var(--icon-size, 24px);
    }
  `

  constructor() {
    super()
    this.name = ''
    this.size = 24
  }

  render() {
    const iconPath = icons[this.name]

    if (!iconPath) {
      console.warn(`[Icon] Unknown icon name: ${this.name}`)
      return html``
    }

    const style = this.size ? `--icon-size: ${this.size}px` : ''

    return html`
      <svg
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        style=${style}
        aria-hidden="true"
      >
        ${unsafeSVG(iconPath)}
      </svg>
    `
  }
}

customElements.define('app-icon', Icon)
