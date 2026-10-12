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
 * Going back or forward to a view brings it back as it was left: each history
 * entry has a key, and a view that has `captureViewState()` has what it returns
 * kept against the entry it was left from; the view shown for that entry again gets
 * it as `restoredState` (set before it is attached, as `route` is). A new
 * navigation is a new entry, so starts clean. The kept state is also in sessionStorage, and
 * the view being shown is captured as the page is hidden, so a reload restores it too.
 *
 * The current route is also provided as a Lit context (route-context.js), and
 * sent as a RouteChangeEvent.
 */
import { provideRoute } from './route-context.ts'
import { buildUrl, historyAction, isDescent, matchRoute, type Route } from './router.ts'
import type { ViewState } from './views/page-view.ts'

/** The route changed (sent on document, after the new view is showing) */
export class RouteChangeEvent extends Event {
  static readonly type = 'router:route-change'
  readonly route: Route
  readonly previous: Route | null
  constructor(route: Route, previous: Route | null) {
    super(RouteChangeEvent.type)
    this.route = route
    this.previous = previous
  }
}

/** A view the router shows: an element that is told its route (a PageView, or the error view) */
export interface ShownView extends HTMLElement {
  route?: Route
  restoredState?: ViewState
  captureViewState?(): ViewState | undefined
}

export interface ViewEntry {
  /** makes the view */
  load: (route: Route) => ShownView | Promise<ShownView>
  /** the document title for a route */
  title?: (route: Route) => string
  /** whether moving between two routes of this view keeps the same element (by default, always) */
  sameView?: (previous: Route, next: Route) => boolean
}

export interface AppRouterOptions {
  /** where views are shown */
  outlet: Element
  /** by route name. Add a 'not-found' view to show for URLs that are no page. */
  views: Record<string, ViewEntry>
  /** swap views in a view transition */
  transitions?: boolean
  /** an aria-live region, told the page title when the view changes */
  announcer?: Element | null
  /** shown when a view fails to load */
  errorView?: (route: Route, error: unknown) => ShownView
  /** how many history entries' view states to keep (the browser keeps about 50 entries) */
  rememberLimit?: number
  /** where to keep them across a reload (default sessionStorage; null for nowhere) */
  storage?: Storage | null
}

const ignore = () => undefined

const newKey = () => crypto.randomUUID()

const STORAGE_KEY = 'chordless:view-states'

/**
 * The title of a page, as the document is given it. In an installed app's window the browser
 * writes "<app name> - <title>", so a title that ends "- Chordless" would say it twice: it is
 * dropped there, and the home page, which is just "Chordless", is "Setlists". A browser tab,
 * which has no app name in front, keeps the full title.
 */
export function pageTitle(title: string, standalone: boolean): string {
  if (!standalone) return title
  const bare = title.replace(/ - Chordless$/, '')
  return bare === 'Chordless' ? 'Setlists' : bare
}

/** sessionStorage, if the browser lets this page have it */
function sessionStorageIfAvailable(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function defaultErrorView(): ShownView {
  const view = document.createElement('div')
  view.setAttribute('role', 'alert')
  view.textContent = 'This page could not be loaded. Reload to try again.'
  return view
}

export class AppRouter {
  #outlet: Element
  #views: Record<string, ViewEntry>
  #defaultTitle: string
  /** The title the shown view gave itself (see setTitle), if it did */
  #viewTitle: string | null = null
  #transitions: boolean
  #announcer: Element | null
  #errorView: (route: Route, error: unknown) => ShownView
  #route: Route | null = null
  #view: ShownView | null = null
  #navigation = 0
  #started = false
  // View state by history entry key, and the key of the entry the current view was shown for
  #viewStates = new Map<string, ViewState>()
  #rememberLimit: number
  #storage: Storage | null
  #shownKey: string | null = null

  constructor({
    outlet,
    views,
    transitions = true,
    announcer = null,
    errorView = defaultErrorView,
    rememberLimit = 50,
    storage = sessionStorageIfAvailable(),
  }: AppRouterOptions) {
    this.#rememberLimit = rememberLimit
    this.#storage = storage
    this.#loadStates()
    this.#outlet = outlet
    this.#views = views
    this.#transitions = transitions
    this.#announcer = announcer
    this.#errorView = errorView
    this.#defaultTitle = document.title
  }

  /** The route being shown (null before start) */
  get route(): Route | null {
    return this.#route
  }

  /** The element showing it */
  get view(): ShownView | null {
    return this.#view
  }

  /** True if this route has a view, so moving to it needs no page load */
  handles(route: Route): boolean {
    return route.name in this.#views
  }

  /**
   * Listen for clicks and history moves, and show the view for the current URL.
   * @returns false if the current URL is not handled here
   */
  async start(): Promise<boolean> {
    if (!this.#started) {
      this.#started = true
      document.addEventListener('click', this.#onClick)
      window.addEventListener('popstate', this.#onPopState)
      window.addEventListener('pagehide', this.#onPageHide)
      document.addEventListener('visibilitychange', this.#onPageHide)
    }
    const route = matchRoute(window.location)
    if (!this.handles(route)) return false
    // The entry we load on needs a key too (state a reload kept has one already)
    if (!window.history.state?.key) {
      window.history.replaceState({ ...window.history.state, key: newKey() }, '')
    }
    await this.#show(route)
    return true
  }

  stop(): void {
    document.removeEventListener('click', this.#onClick)
    window.removeEventListener('popstate', this.#onPopState)
    window.removeEventListener('pagehide', this.#onPageHide)
    document.removeEventListener('visibilitychange', this.#onPageHide)
    this.#started = false
    this.#navigation++
    this.#view?.remove()
    this.#view = null
    this.#route = null
    this.#viewStates.clear()
    this.#shownKey = null
    provideRoute(null)
  }

  /**
   * Go to a route, adding to the history as historyAction() decides.
   * @param target a URL or route
   * @returns false if there is no view for it, and nothing was done: the caller should load
   *   the page
   */
  async navigate(
    target: string | Route,
    { replace = false }: { replace?: boolean } = {}
  ): Promise<boolean> {
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
        const state: { key: string; fromParent?: boolean } = { key: newKey() }
        if (from && isDescent(from, route)) state.fromParent = true
        window.history.pushState(state, '', url)
      } else {
        // Replacing keeps the entry, so its key
        const state: { key: string; fromParent?: boolean } = {
          key: window.history.state?.key ?? newKey(),
        }
        if (window.history.state?.fromParent) state.fromParent = true
        window.history.replaceState(state, '', url)
      }
    }
    await this.#show(route, commit)
    return true
  }

  /** The page is going away, or out of sight (a reload, a closed or switched tab): keep the view as it is */
  #onPageHide = (event: Event): void => {
    // visibilitychange comes for showing as well as hiding
    if (event.type === 'visibilitychange' && document.visibilityState !== 'hidden') return
    this.#remember(this.#shownKey, this.#view?.captureViewState?.())
  }

  #onPopState = (): void => {
    const route = matchRoute(window.location)
    if (this.handles(route)) {
      this.#show(route)
    } else {
      // biome-ignore lint/plugin: no view for this entry, so load it as a page
      window.location.reload()
    }
  }

  #onClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const link = event
      .composedPath()
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement)
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
  async #show(route: Route, commit: () => void = ignore): Promise<void> {
    const previous = this.#route
    const entry = this.#views[route.name]
    const keep = this.#view && previous && this.#isSameView(previous, route)
    // Only a navigation that loads a view can be overtaken by a newer one. A move within the
    // view is done at once, and must not cancel a change of view that is still loading (as a
    // search put in the URL after a pause would when the user has just tapped a link)
    const navigation = keep ? this.#navigation : ++this.#navigation

    let view: ShownView | null = this.#view
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

    if (!view) return
    commit()
    view.route = route
    if (!keep) {
      // What the view being left shows, kept for if its entry is come back to; and what was
      // kept for the entry this view is for, if it was left before
      this.#remember(this.#shownKey, this.#view?.captureViewState?.())
      view.restoredState = this.#viewStates.get(window.history.state?.key)
      await this.#swap(() => this.#outlet.replaceChildren(view))
      if (navigation !== this.#navigation) return
      this.#view = view
    }
    this.#shownKey = window.history.state?.key ?? null
    this.#route = route

    // A view's own title belongs to that view: a new view starts with its entry's
    if (!keep) this.#viewTitle = null
    this.#showTitle(route)
    if (!keep) this.#announceView(view, previous)
    provideRoute(route)
    document.dispatchEvent(new RouteChangeEvent(route, previous))
  }

  /** Set the document title from the shown view's own title, else its entry's, else the page's */
  #showTitle(route: Route): void {
    const entry = this.#views[route.name]
    const title = this.#viewTitle
      ? `${this.#viewTitle} - Chordless`
      : (entry?.title?.(route) ?? this.#defaultTitle)
    document.title = pageTitle(title, window.matchMedia('(display-mode: standalone)').matches)
  }

  /**
   * Give the view being shown a title of its own, such as a setlist's date and name (null goes
   * back to its entry's). It is kept for as long as the view stays, as it does while the
   * user moves between a setlist's songs, and a new view starts without it.
   * @param title the title without the app's name, which is added (or, in an installed app's
   *   window, which has it already, left off)
   */
  setTitle(title: string | null): void {
    this.#viewTitle = title
    if (this.#route) this.#showTitle(this.#route)
  }

  /** Keep a view's state against the history entry it was left from, the latest few */
  #remember(key: string | null, state: ViewState | undefined): void {
    if (!key) return
    this.#viewStates.delete(key)
    if (state !== undefined) {
      this.#viewStates.set(key, state)
      if (this.#viewStates.size > this.#rememberLimit) {
        const oldest = this.#viewStates.keys().next().value
        if (oldest !== undefined) this.#viewStates.delete(oldest)
      }
    }
    this.#saveStates()
  }

  /** What was kept before a reload (it must be something JSON can hold) */
  #loadStates(): void {
    try {
      const saved = JSON.parse(this.#storage?.getItem(STORAGE_KEY) ?? 'null')
      if (Array.isArray(saved)) {
        for (const [key, state] of saved) this.#viewStates.set(key, state)
      }
    } catch {
      // unreadable: start without
    }
  }

  #saveStates(): void {
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify([...this.#viewStates]))
    } catch {
      // full, or not allowed: the state is kept in memory only
    }
  }

  /**
   * Tell assistive technology the page changed: announce its title, and move
   * focus to the view if it takes focus (has a tabindex).
   */
  #announceView(view: ShownView, previous: Route | null): void {
    // Not for the first view: the page has just loaded, which the browser announces
    // itself, and focus is where it put it
    if (!previous) return
    if (this.#announcer) this.#announcer.textContent = document.title
    if (view.hasAttribute('tabindex')) view.focus({ preventScroll: true })
  }

  #isSameView(previous: Route, next: Route): boolean {
    if (previous.name !== next.name) return false
    return this.#views[next.name].sameView?.(previous, next) ?? true
  }

  async #swap(update: () => void): Promise<void> {
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

declare global {
  interface GlobalEventHandlersEventMap {
    [RouteChangeEvent.type]: RouteChangeEvent
  }
}
