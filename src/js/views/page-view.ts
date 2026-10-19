import { LitElement } from 'lit'
import type { Route } from '../router.ts'

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

/** What a view keeps of itself for when the user comes back to it (JSON-able) */
export interface ViewState {
  scroll?: number
  [key: string]: unknown
}

/**
 * Base for the views the router shows (see AppRouter): rendered in the light
 * DOM, so the page's stylesheet and the ids tests use apply, and laid out as
 * one of .app-container's flex children (class "view").
 *
 * The router sets `route` (see router.js) when it shows the view, and again if
 * the route changes within it: react in willUpdate().
 *
 * Coming back to a view with the back or forward button, it should look as it was
 * left. The router asks for `captureViewState()` when the view is left (return
 * something JSON can hold, or nothing), and gives what that
 * returned as `restoredState` when the view is made for that history entry again.
 * By default a view keeps its <main>'s scroll position.
 */
export class PageView extends LitElement {
  static override properties = {
    route: { attribute: false },
    restoredState: { attribute: false },
  }

  declare route: Route | undefined
  declare restoredState: ViewState | undefined

  override connectedCallback() {
    super.connectedCallback()
    this.classList.add('view')
  }

  override createRenderRoot() {
    return this
  }

  /** What to show again if the user comes back: see above */
  captureViewState(): ViewState | undefined {
    const scroll = this.querySelector('main')?.scrollTop
    return scroll ? { scroll } : undefined
  }

  override firstUpdated() {
    this.restoreScroll(this.querySelector('main'), this.restoredState?.scroll)
  }

  /**
   * Scroll an element to `top` once the view has drawn enough to reach it: what it
   * shows may load after it first renders, so wait a little (a third of a second at most).
   */
  async restoreScroll(
    element: HTMLElement | null | undefined,
    top: number | undefined
  ): Promise<void> {
    if (!element || !top) return
    await this.updateComplete
    for (let frame = 0; frame < 20; frame++) {
      if (element.scrollHeight - element.clientHeight >= top) break
      await nextFrame()
    }
    element.scrollTop = top
  }
}
