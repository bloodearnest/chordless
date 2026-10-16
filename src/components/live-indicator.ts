import { css, html, LitElement, nothing } from 'lit'
import { RouteChangeEvent } from '../js/app-router.ts'
import { getLive, isLiveSetlist, LiveChangeEvent, type LiveState, leaveLive } from '../js/live.ts'
import { buildUrl, type Route } from '../js/router.ts'
import { buttonStyles } from './shared-styles.ts'

/**
 * LiveIndicator Component
 *
 * A small chip in a corner of the shell that says the device is live ("Live: Sunday AM"), so a
 * live state left on can't go unnoticed. Pressing it opens a small menu with the way back to the
 * live setlist and the way to leave live: two taps to leave, so a stray touch can't end it.
 *
 * It is not shown on a song of the live setlist, where the whole screen is the song: the
 * overview has the Live now state and Leave live button.
 */
export class LiveIndicator extends LitElement {
  static override properties = {
    _live: { state: true },
    _route: { state: true },
  }

  declare _live: LiveState | null
  declare _route: Route | null

  constructor() {
    super()
    this._live = getLive()
    this._route = null
  }

  static override styles = [
    buttonStyles,
    css`
      :host {
        position: fixed;
        left: max(1rem, env(safe-area-inset-left));
        bottom: max(1rem, env(safe-area-inset-bottom));
        z-index: 40;
        font-family: var(--font-family-base);
      }

      :host([hidden]) {
        display: none;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        min-height: 2.75rem;
        max-width: min(18rem, 60vw);
        padding: 0.4rem 1rem;
        border: none;
        border-radius: 999px;
        background: var(--header-bg);
        color: var(--header-text);
        box-shadow: var(--modal-shadow);
        font: inherit;
        font-size: var(--font-ui-small);
        cursor: pointer;
      }

      .chip span:last-child {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .dot {
        flex: none;
        width: 0.65rem;
        height: 0.65rem;
        border-radius: 50%;
        background: var(--color-danger);
      }

      .chip:focus-visible,
      .menu a:focus-visible,
      .menu button:focus-visible {
        outline: 2px solid var(--focus-ring);
        outline-offset: 2px;
      }

      .menu {
        position: fixed;
        inset: auto auto calc(max(1rem, env(safe-area-inset-bottom)) + 3.5rem)
          max(1rem, env(safe-area-inset-left));
        margin: 0;
        padding: 0.5rem;
        border: none;
        border-radius: 8px;
        background: var(--header-bg);
        color: var(--header-text);
        box-shadow: var(--modal-shadow);
        flex-direction: column;
        gap: 0.25rem;
      }

      .menu:popover-open {
        display: flex;
      }

      .menu a,
      .menu button {
        display: block;
        padding: 0.75rem 1rem;
        border: none;
        border-radius: 6px;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        text-decoration: none;
        cursor: pointer;
      }

      .menu a:hover,
      .menu button:hover {
        background: color-mix(in srgb, var(--header-text) 15%, transparent);
      }
    `,
  ]

  override connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener(LiveChangeEvent.type, this._onLiveChange)
    document.addEventListener(RouteChangeEvent.type, this._onRouteChange)
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener(LiveChangeEvent.type, this._onLiveChange)
    document.removeEventListener(RouteChangeEvent.type, this._onRouteChange)
  }

  _onLiveChange = (event: LiveChangeEvent): void => {
    this._live = event.live
  }

  _onRouteChange = (event: RouteChangeEvent): void => {
    this._route = event.route
  }

  /** On a song of the live setlist: where the indicator stays out of the way */
  _onLiveSong(): boolean {
    const route = this._route
    if (!this._live || !route || (route.name !== 'setlist' && route.name !== 'share')) return false
    return route.songIndex >= 0 && isLiveSetlist(this._live, buildUrl(route))
  }

  _leave(): void {
    this.shadowRoot?.querySelector<HTMLElement>('.menu')?.hidePopover()
    leaveLive()
  }

  override render() {
    const live = this._live
    this.toggleAttribute('hidden', !live || this._onLiveSong())
    if (!live) return nothing
    return html`
      <button type="button" class="chip" id="live-chip" popovertarget="live-menu">
        <span class="dot" aria-hidden="true"></span>
        <span>Live${live.title ? html`: ${live.title}` : nothing}</span>
      </button>
      <div class="menu" id="live-menu" popover>
        <a href=${live.url}>Open the live setlist</a>
        <button type="button" id="leave-live" @click=${this._leave}>Leave live</button>
      </div>
    `
  }
}
customElements.define('live-indicator', LiveIndicator)

declare global {
  interface HTMLElementTagNameMap {
    'live-indicator': LiveIndicator
  }
}
