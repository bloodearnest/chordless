import { LitElement } from 'lit'

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()))

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
  static properties = {
    route: { attribute: false },
    restoredState: { attribute: false },
  }

  connectedCallback() {
    super.connectedCallback()
    this.classList.add('view')
  }

  createRenderRoot() {
    return this
  }

  /** What to show again if the user comes back: see above */
  captureViewState() {
    const scroll = this.querySelector('main')?.scrollTop
    return scroll ? { scroll } : undefined
  }

  firstUpdated() {
    this.restoreScroll(this.querySelector('main'), this.restoredState?.scroll)
  }

  /**
   * Scroll an element to `top` once the view has drawn enough to reach it: what it
   * shows may load after it first renders, so wait a little (a third of a second at most).
   */
  async restoreScroll(element, top) {
    if (!element || !top) return
    await this.updateComplete
    for (let frame = 0; frame < 20; frame++) {
      if (element.scrollHeight - element.clientHeight >= top) break
      await nextFrame()
    }
    element.scrollTop = top
  }
}
