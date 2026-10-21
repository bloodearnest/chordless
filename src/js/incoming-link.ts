/**
 * A link's #fragment, handed to the page it is for. A browser tab keeps the fragment, but the
 * installed app is launched through launchQueue (see launch.ts), and routes are paths, so the
 * fragment of any link it is launched with is kept here, with the path it came with: a setlist
 * from the email Worker (/import-setlist#...), an invite to a team space (/join#...), a share link
 * (/s/<id>#<key>). A page takes the fragment kept for its own path, when it opens or, if it is
 * open, when the event says one came. A fragment for another page is left alone, so one that
 * nothing took cannot be taken by a page it was not for.
 */

/** A link was offered (sent on window) */
export class IncomingLinkEvent extends Event {
  static readonly type = 'chordless:incoming-link'
  constructor() {
    super(IncomingLinkEvent.type)
  }
}

let pending: { path: string; fragment: string } | null = null

/** Offer a link's fragment ("#...") to the page at `path`, which may not be open yet */
export function offerLink(path: string, fragment: string): void {
  pending = { path, fragment }
  window.dispatchEvent(new IncomingLinkEvent())
}

/** Take the fragment waiting for the page at `path`, if there is one */
export function takeLink(path: string): string | null {
  if (pending?.path !== path) return null
  const { fragment } = pending
  pending = null
  return fragment
}

declare global {
  interface GlobalEventHandlersEventMap {
    [IncomingLinkEvent.type]: IncomingLinkEvent
  }
}
