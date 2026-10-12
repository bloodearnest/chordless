import { html, nothing } from 'lit'
import '../../components/app-header.ts'
import type { ChordlessDB } from '../db.ts'
import type { Route } from '../router.ts'
import { SetlistPage } from '../setlist-page.ts'
import { openShare, SHARED_SETLIST_ID, type ShareOpening } from '../share-receiver.ts'
import { wakeLock } from '../wake-lock.ts'
import { PageView } from './page-view.ts'
import { setlistTemplate } from './setlist-view.ts'

type ShareRoute = Extract<Route, { name: 'share' }>

/** What to tell someone whose link can't show a setlist */
const MESSAGES: Record<
  Exclude<ShareOpening['state'], 'ready'> | 'loading',
  { heading: string; text: string }
> = {
  loading: { heading: 'Opening…', text: 'Getting the setlist.' },
  ended: {
    heading: 'This share has ended',
    text: 'The person who sent it stopped sharing, or it has expired. Ask them for a new link if you still need it.',
  },
  'needs-key': {
    heading: 'This link is incomplete',
    text: 'The end of the link is missing, so the setlist cannot be opened. Ask for the whole link again, or scan its QR code.',
  },
  'bad-key': {
    heading: "This link doesn't open the setlist",
    text: 'The link looks cut short or changed. Ask for it again, or scan its QR code.',
  },
  unavailable: {
    heading: "Can't reach the setlist",
    text: 'Connect to the internet and open the link again. After that it works without a connection.',
  },
}

/**
 * A setlist someone shared by link (/s/<file id>#<key>): read-only, and kept on this device
 * on its own, so it still opens offline. The setlist page shows it, from a database of its own.
 */
export class ShareView extends PageView {
  static override properties = {
    ...PageView.properties,
    _opening: { state: true },
  }

  declare _opening: ShareOpening | 'loading'
  #page: SetlistPage | null = null
  #db: ChordlessDB | null = null

  constructor() {
    super()
    this._opening = 'loading'
  }

  #shareRoute(): ShareRoute {
    const route = this.route
    if (route?.name !== 'share') throw new Error('The share view has no share route')
    return route
  }

  override async firstUpdated() {
    wakeLock.hold()
    const { fileId, songIndex } = this.#shareRoute()
    // The key is in the link's fragment, which browsers never send to a server. (Not a route:
    // routes stay paths.)
    // biome-ignore lint/plugin: the share key is the link's fragment
    const key = location.hash.slice(1)
    let opening: ShareOpening
    try {
      opening = await openShare(fileId, key)
    } catch (error) {
      console.error('[ShareView] Failed to open the share:', error)
      opening = { state: 'unavailable', offline: false }
    }
    if (!this.isConnected) {
      if (opening.state === 'ready') opening.db.db?.close()
      return
    }
    this._opening = opening
    if (opening.state !== 'ready') return

    this.#db = opening.db
    await this.updateComplete
    this.#page = new SetlistPage({
      root: this,
      setlistId: SHARED_SETLIST_ID,
      songIndex,
      restoredState: this.restoredState,
      db: opening.db,
      readOnly: true,
      routeFor: index => ({ name: 'share', fileId, songIndex: index }),
    })
    this.#page
      .start()
      .then(() => this.#page?.routeChanged(this.#shareRoute()))
      .catch(error => console.error('[ShareView] Failed to start:', error))
  }

  override captureViewState() {
    return this.#page?.captureViewState()
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.get('route') !== undefined) this.#page?.routeChanged(this.#shareRoute())
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    wakeLock.letGo()
    this.#page?.dispose()
    this.#page = null
    this.#db?.db?.close()
    this.#db = null
  }

  override render() {
    const opening = this._opening
    if (opening !== 'loading' && opening.state === 'ready') {
      // On the overview only: a song takes the whole screen
      const route = this.route?.name === 'share' ? this.route : null
      const owner = opening.setlist.owner?.trim()
      const banner =
        route && route.songIndex < 0
          ? html`
            <aside class="share-banner" id="share-banner">
              <span>
                Shared with you${owner ? html` by <strong>${owner}</strong>` : nothing}. You can
                read it here, with no account.
              </span>
              <a href="/about">What is Chordless?</a>
            </aside>
          `
          : nothing
      return setlistTemplate({ editable: false, belowHeader: banner })
    }
    const state = opening === 'loading' ? 'loading' : opening.state
    const message =
      state === 'unavailable' &&
      opening !== 'loading' &&
      opening.state === 'unavailable' &&
      opening.offline
        ? { ...MESSAGES.unavailable, heading: "You're offline" }
        : MESSAGES[state as keyof typeof MESSAGES]
    return html`
      <app-header heading="Shared setlist"></app-header>
      <main class="home-content">
        <h2 style="margin: 2rem 1rem 1rem 1rem" id="share-status" data-state=${state}>
          ${message.heading}
        </h2>
        <p style="margin: 0 1rem 1rem">${message.text}</p>
        ${
          state === 'loading'
            ? nothing
            : html`<p style="margin: 0 1rem"><a href="/">Go to Chordless</a></p>`
        }
      </main>
    `
  }
}
customElements.define('share-view', ShareView)

declare global {
  interface HTMLElementTagNameMap {
    'share-view': ShareView
  }
}
