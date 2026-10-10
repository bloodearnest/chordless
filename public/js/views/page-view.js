import { LitElement } from 'lit'

/**
 * Base for the views the router shows (see AppRouter): rendered in the light
 * DOM, so the page's stylesheet and the ids tests use apply, and laid out as
 * one of .app-container's flex children (class "view").
 *
 * The router sets `route` (see router.js) when it shows the view, and again if
 * the route changes within it: react in willUpdate().
 */
export class PageView extends LitElement {
  static properties = {
    route: { attribute: false },
  }

  connectedCallback() {
    super.connectedCallback()
    this.classList.add('view')
  }

  createRenderRoot() {
    return this
  }
}
