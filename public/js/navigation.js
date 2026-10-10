/**
 * Moving to another URL from app code: in place, through the router, when the
 * route has a view; as a page load for the pages that are not views yet.
 * (Links in markup need none of this: the router follows them itself.)
 */
let router = null

/** Called by app.js once the router exists */
export function setRouter(value) {
  router = value
}

/**
 * @param {string} url
 * @param {{replace?: boolean}} [options]
 */
export async function goTo(url, options) {
  if (router && (await router.navigate(url, options))) return
  // biome-ignore lint/plugin: no view for this route yet, so load it as a page
  window.location.assign(url)
}
