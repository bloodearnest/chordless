/**
 * Moving to another URL from app code: in place, through the router. (Only where
 * there is no router, as in a test or a dev page, or for a URL it has no view for,
 * does this load the page.) Links in markup need none of this: the router follows
 * them itself.
 */
/** What goTo needs of the router (AppRouter) */
interface Navigates {
  navigate(url: string, options?: GoOptions): Promise<boolean>
}

export interface GoOptions {
  replace?: boolean
}

let router: Navigates | null = null

/** Called by app.js once the router exists */
export function setRouter(value: Navigates | null) {
  router = value
}

export async function goTo(url: string, options?: GoOptions) {
  if (router && (await router.navigate(url, options))) return
  // biome-ignore lint/plugin: the router can't show it, so load it as a page
  window.location.assign(url)
}
