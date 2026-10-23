/**
 * Moving to another URL from app code: in place, through the router. (Only where
 * there is no router, as in a test or a dev page, or for a URL it has no view for,
 * does this load the page.) Links in markup need none of this: the router follows
 * them itself.
 */
/** What goTo needs of the router (AppRouter) */
interface Navigates {
  navigate(url: string, options?: GoOptions): Promise<boolean>
  setTitle?(title: string | null): void
}

export interface GoOptions {
  replace?: boolean
  /** Make the view afresh even if the route is the one shown (the space it reads has changed) */
  fresh?: boolean
}

let router: Navigates | null = null

/** Called by app.js once the router exists */
export function setRouter(value: Navigates | null) {
  router = value
}

/**
 * Give the page being shown a title of its own, such as a setlist's date and name: without the
 * app's name, which is added where it is wanted. It lasts while the view does.
 */
export function setPageTitle(title: string | null) {
  router?.setTitle?.(title)
}

/* v8 ignore start -- loading a page would end the test run */
/** Load a URL as a page, afresh: for after the space has changed, which the app reads once, as it starts */
export function loadPage(url: string) {
  // biome-ignore lint/plugin: the whole app starts afresh in the other space
  window.location.assign(url)
}
/* v8 ignore stop */

export async function goTo(url: string, options?: GoOptions) {
  /* v8 ignore next 4 -- loading a page would end the test run: tests give a router instead */
  if (router && (await router.navigate(url, options))) return
  // biome-ignore lint/plugin: the router can't show it, so load it as a page
  window.location.assign(url)
}
