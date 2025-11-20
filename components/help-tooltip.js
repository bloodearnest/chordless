import { css, html, LitElement } from 'lit'

export class HelpTooltip extends LitElement {
  static properties = {
    message: { type: String },
    _visible: { state: true },
  }

  constructor() {
    super()
    this.message = ''
    this._visible = false
    this._suppressNextClick = false
  }

  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      font-family: var(
        --help-tooltip-font,
        'Inter',
        'Segoe UI',
        system-ui,
        -apple-system,
        sans-serif
      );
      font-size: 0.85rem;
      color: inherit;
    }

    .trigger {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 0.15rem;
      cursor: help;
      outline: none;
      text-shadow: none;
      font-family: inherit;
      font-size: inherit;
      line-height: 1.1;
    }

    .trigger:focus-visible {
      outline: 1px solid rgba(255, 92, 92, 0.6);
      outline-offset: 2px;
      border-radius: 3px;
    }

    .tooltip {
      position: absolute;
      bottom: calc(100% + 0.35rem);
      left: 50%;
      transform: translate(-50%, 0.2rem);
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 0.35rem 0.5rem;
      border-radius: 4px;
      font-size: 0.7rem;
      line-height: 1.3;
      white-space: nowrap;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
      opacity: 0;
      pointer-events: none;
      transition:
        opacity 150ms ease,
        transform 150ms ease;
      z-index: 10;
    }

    .tooltip::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border-width: 5px;
      border-style: solid;
      border-color: rgba(0, 0, 0, 0.9) transparent transparent transparent;
    }

    .tooltip.visible {
      opacity: 1;
      pointer-events: auto;
      transform: translate(-50%, -0.1rem);
    }
  `

  render() {
    return html`
      <span
        class="trigger"
        tabindex="0"
        @pointerenter=${this._handlePointerEnter}
        @pointerleave=${this._handlePointerLeave}
        @focus=${this._handleFocus}
        @blur=${this._handleBlur}
        @pointerdown=${this._handlePointerDown}
        @click=${this._handleClick}
      >
        <slot></slot>
        <span class="tooltip ${this._visible ? 'visible' : ''}" role="tooltip">
          ${this.message}
        </span>
      </span>
    `
  }

  _handlePointerEnter(event) {
    if (event.pointerType === 'mouse' || event.pointerType === '') {
      this._visible = true
    }
  }

  _handlePointerLeave(event) {
    if (event.pointerType === 'mouse' || event.pointerType === '') {
      this._visible = false
    }
  }

  _handleFocus() {
    this._visible = true
  }

  _handleBlur() {
    this._visible = false
  }

  _handlePointerDown(event) {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      event.preventDefault()
      this._visible = !this._visible
      this._suppressNextClick = true
    }
  }

  _handleClick(event) {
    if (this._suppressNextClick) {
      event.preventDefault()
      event.stopPropagation()
      this._suppressNextClick = false
      return
    }
    this._visible = false
  }
}

customElements.define('help-tooltip', HelpTooltip)
