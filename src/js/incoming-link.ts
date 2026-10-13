/**
 * A setlist link from the email Worker (/import-setlist#...) opened in the installed app. A browser
 * tab keeps the link's fragment, but the installed app is launched through launchQueue (see
 * launch.ts), and routes are paths, so the fragment is handed to the import page here. The page
 * takes it when it opens, or at once if it is open.
 */

/** A link was offered to the import page (sent on window) */
export class IncomingLinkEvent extends Event {
  static readonly type = 'chordless:incoming-link'
  constructor() {
    super(IncomingLinkEvent.type)
  }
}

let pending: string | null = null

/** Offer a link's fragment ("#...") to the import page, which may not be open yet */
export function offerLink(fragment: string): void {
  pending = fragment
  window.dispatchEvent(new IncomingLinkEvent())
}

/** Take the fragment waiting, if there is one */
export function takeLink(): string | null {
  const fragment = pending
  pending = null
  return fragment
}

declare global {
  interface GlobalEventHandlersEventMap {
    [IncomingLinkEvent.type]: IncomingLinkEvent
  }
}
