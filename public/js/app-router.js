/**
 * The router runtime: shows the view for the current URL in an outlet, follows
 * link clicks and the browser's back/forward buttons without reloading the page,
 * and keeps the history. (Parsing and building URLs is router.js.)
 *
 * A route only navigates in place if it has a view; any other link is left to
 * the browser, so pages can move over one at a time.
 *
 * Views are elements. The router sets their `route` property, before attaching
 * a view and again whenever the route changes within it (another song in the
 * same setlist): react to it as to any property, in willUpdate. The router
 * removes a view when leaving it: use disconnectedCallback to clean up.
 *
 * A view is loaded before the URL changes, so a slow or failed load never
 * leaves the address bar pointing at nothing; a failed load shows an error view.
 * Views own their scrolling, as the page itself does not scroll.
 *
 * The current route is also provided as a Lit context (route-context.js), and
 * sent as a RouteChangeEvent.
 */
import { provideRoute } from './route-context.js'
import { buildUrl, historyAction, isDescent, matchRoute } from './router.js'

/** The route changed (sent on document, after the new view is showing) */
export class RouteChangeEvent extends Event {
  static type = 'router:route-change'
  constructor(route, previous) {
    super(RouteChangeEvent.type)
    this.route = route
    this.previous = previous
  }
}

/**
 * @typedef {object} ViewEntry
 * @property {(route: object) => HTMLElement | Promise<HTMLElement>} load makes the view
 * @property {(route: object) => string} [title] the document title for a route
 * @property {(previous: object, next: object) => boolean} [sameView] whether moving
 *   between two routes of this view keeps the same element (by default, always)
 */

const ignore = () => undefined

function defaultErrorView() {
  const view = document.createElement('div')
  view.setAttribute('role', 'alert')
  view.textContent = 'This page could not be loaded. Reload to try again.'
  return view
}

export class AppRouter {
  #outlet
  #views
  #defaultTitle
  #transitions
  #announcer
  #errorView
  #route = null
  #view = null
  #navigation = 0
  #started = false

  /**
   * @param {object} options
   * @param {Element} options.outlet where views are shown
   * @param {Record<string, ViewEntry>} options.views by route name. Add a
   *   'not-found' view to show for URLs that are no page.
   * @param {boolean} [options.transitions] swap views in a view transition
   * @param {Element} [options.announcer] an aria-live region, told the page title
   *   when the view changes
   * @param {(route: object, error: Error) => HTMLElement} [options.errorView]
   *   shown when a view fails to load
   */
  constructor({
    outlet,
    views,
    transitions = true,
    announcer = null,
    errorView = defaultErrorView,
  }) {
    this.#outlet = outlet
    this.#views = views
    this.#transitions = transitions
    this.#announcer = announcer
    this.#errorView = errorView
    this.#defaultTitle = document.title
  }

  /** The route being shown (null before start) */
  get route() {
    return this.#route
  }

  /** The element showing it */
  get view() {
    return this.#view
  }

  /** True if this route has a view, so moving to it needs no page load */
  handles(route) {
    return route.name in this.#views
  }

  /**
   * Listen for clicks and history moves, and show the view for the current URL.
   * @returns {Promise<boolean>} false if the current URL is not handled here
   */
  async start() {
    if (!this.#started) {
      this.#started = true
      document.addEventListener('click', this.#onClick)
      window.addEventListener('popstate', this.#onPopState)
    }
    const route = matchRoute(window.location)
    if (!this.handles(route)) return false
    await this.#show(route)
    return true
  }

  stop() {
    document.removeEventListener('click', this.#onClick)
    window.removeEventListener('popstate', this.#onPopState)
    this.#started = false
    this.#navigation++
    this.#view?.remove()
    this.#view = null
    this.#route = null
    provideRoute(null)
  }

  /**
   * Go to a route, adding to the history as historyAction() decides.
   * @param {string | object} target a URL or route
   * @param {{replace?: boolean}} [options]
   * @returns {Promise<boolean>} false if there is no view for it, and nothing
   *   was done: the caller should load the page
   */
  async navigate(target, { replace = false } = {}) {
    const route = typeof target === 'string' ? matchRoute(target) : target
    if (!this.handles(route)) return false

    const from = this.#route
    const action = !from || replace ? 'replace' : historyAction(from, route, window.history.state)
    if (action === 'back') {
      // The popstate that follows shows the view
      window.history.back()
      return true
    }

    const url = buildUrl(route)
    const commit = () => {
      if (action === 'push') {
        window.history.pushState(isDescent(from, route) ? { fromParent: true } : {}, '', url)
      } else {
        const fromParent = window.history.state?.fromParent ?? false
        window.history.replaceState(fromParent ? { fromParent } : {}, '', url)
      }
    }
    await this.#show(route, commit)
    return true
  }

  #onPopState = () => {
    const route = matchRoute(window.location)
    if (this.handles(route)) {
      this.#show(route)
    } else {
      // biome-ignore lint/plugin: no view for this entry, so load it as a page
      window.location.reload()
    }
  }

  #onClick = event => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const link = event.composedPath().find(node => node instanceof HTMLAnchorElement)
    if (!link?.hasAttribute('href')) return
    if (link.target && link.target !== '_self') return
    if (link.hasAttribute('download') || link.relList.contains('external')) return

    const url = new URL(link.href, window.location.href)
    if (url.origin !== window.location.origin) return
    // A link to a place on this page is for the browser to scroll to
    if (url.pathname === window.location.pathname && url.hash) return

    const route = matchRoute(url)
    if (!this.handles(route)) return

    event.preventDefault()
    this.navigate(route)
  }

  /**
   * Show a route: load its view (or keep the current one if it stays the same),
   * then `commit` the URL, then show it.
   */
  async #show(route, commit = ignore) {
    const navigation = ++this.#navigation
    const previous = this.#route
    const entry = this.#views[route.name]
    const keep = this.#view && previous && this.#isSameView(previous, route)

    let view = this.#view
    if (!keep) {
      try {
        view = await entry.load(route)
      } catch (error) {
        console.error(`[AppRouter] Failed to load the ${route.name} view:`, error)
        view = this.#errorView(route, error)
      }
      // A newer navigation started while this view loaded
      if (navigation !== this.#navigation) return
    }

    commit()
    view.route = route
    if (!keep) {
      await this.#swap(() => this.#outlet.replaceChildren(view))
      if (navigation !== this.#navigation) return
      this.#view = view
    }
    this.#route = route

    document.title = entry.title?.(route) ?? this.#defaultTitle
    if (!keep) this.#announceView(view, previous)
    provideRoute(route)
    document.dispatchEvent(new RouteChangeEvent(route, previous))
  }

  /**
   * Tell assistive technology the page changed: announce its title, and move
   * focus to the view if it takes focus (has a tabindex).
   */
  #announceView(view, previous) {
    // Not for the first view: the page has just loaded, which the browser announces
    // itself, and focus is where it put it
    if (!previous) return
    if (this.#announcer) this.#announcer.textContent = document.title
    if (view.hasAttribute('tabindex')) view.focus({ preventScroll: true })
  }

  #isSameView(previous, next) {
    if (previous.name !== next.name) return false
    return this.#views[next.name].sameView?.(previous, next) ?? true
  }

  async #swap(update) {
    if (this.#transitions && document.startViewTransition) {
      const transition = document.startViewTransition(update)
      // A transition skipped for a newer one rejects these, which is harmless
      transition.ready.catch(ignore)
      transition.finished.catch(ignore)
      await transition.updateCallbackDone
    } else {
      update()
    }
  }
}
