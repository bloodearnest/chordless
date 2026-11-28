import type { Route } from '../router.ts'
import { PageView } from './page-view.ts'

/** The space and the invite's code, from an older link's fragment: `#<space id>.<code>` */
const OLD_FRAGMENT = /^#?([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{16,64})$/

/**
 * Where an invite link goes: the church's page, which joins the person to the church with it. A team invite and a
 * church's are one kind, kept by the Worker for the team (`/api/church-invites/join`), so a link sent before the team was
 * its church's, `/join/<team>/<code>` (or older, `/join#<team>.<code>`), works there too. One with no invite in it is the
 * church's page as it is.
 */
export function churchJoinUrl(route: Route | undefined, fragment: string): string {
  const old = OLD_FRAGMENT.exec(fragment)
  const team = route?.name === 'join' && route.teamId ? route.teamId : old?.[1]
  const code = route?.name === 'join' && route.code ? route.code : old?.[2]
  if (!team || !code) return '/account/churches'
  return `/account/churches#${new URLSearchParams({ team, code })}`
}

/**
 * An invite link, /join/<team>/<code>: on to the church's page, in place of this one in the history. A page load, not the
 * router's: the invite is in the church page's fragment, which a route does not carry.
 */
export class JoinView extends PageView {
  /** Goes to the church's page (a test gives its own) */
  /* v8 ignore next 2 -- a page load would end the test run: the tests give their own */
  // biome-ignore lint/plugin: the church's page reads the invite from its fragment, which the router drops
  go: (url: string) => void = url => window.location.replace(url)

  override willUpdate(changed: Map<string, unknown>): void {
    // biome-ignore lint/plugin: an older invite is the link's fragment (not a route)
    if (changed.has('route')) this.go(churchJoinUrl(this.route, window.location.hash))
  }
}
customElements.define('join-view', JoinView)

declare global {
  interface HTMLElementTagNameMap {
    'join-view': JoinView
  }
}
