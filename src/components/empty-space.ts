import { html, LitElement } from 'lit'
import type { Space } from '../js/data-types.ts'
import { emptySpaceKind } from '../js/empty-space-kind.ts'
import { SyncStatusEvent, syncRunning } from '../js/sync-status.ts'
import { t } from '../js/text.ts'
import { toast } from '../js/toast.ts'
import { errorMessage } from '../js/utils/errors.ts'
import './progress-bar.ts'
import './status-message.ts'

/**
 * EmptySpace
 *
 * The home page's answer for a space with no setlists that is not a new user's (the welcome card is
 * that): the files of a team being fetched, with how far that has got, a space not fetched yet with a
 * button to fetch it, or a space that has nothing in it. It follows the space's sync, so it changes
 * by itself when the sync ends (the page shows the setlists then).
 */
export class EmptySpace extends LitElement {
  static override properties = {
    space: { attribute: false },
    _busy: { state: true },
  }

  declare space: Space
  declare _busy: boolean

  constructor() {
    super()
    this._busy = false
  }

  override connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener(SyncStatusEvent.type, this._onStatus)
  }

  override disconnectedCallback(): void {
    window.removeEventListener(SyncStatusEvent.type, this._onStatus)
    super.disconnectedCallback()
  }

  /** Fetches the space's songs and setlists (a test gives its own) */
  /* v8 ignore next 4 -- wiring to the server sync of the space, which the Playwright tests run */
  fetchSpace: (space: Space) => Promise<unknown> = async space => {
    const { syncSpaceNow } = await import('../js/space-sync.ts')
    return syncSpaceNow(space)
  }

  _onStatus = (event: SyncStatusEvent): void => {
    if (event.spaceId === this.space.id) this.requestUpdate()
  }

  async _fetch(): Promise<void> {
    this._busy = true
    try {
      await this.fetchSpace(this.space)
    } catch (error) {
      toast(t('toast-space-fetch-failed', { space: this.space.name }), {
        kind: 'error',
        details: errorMessage(error),
        action: { label: t('action-try-again'), run: () => void this._fetch() },
      })
    }
    this._busy = false
  }

  override render() {
    const { space } = this
    switch (emptySpaceKind(space)) {
      case 'syncing': {
        const progress = syncRunning(space.id)?.progress
        return html`
          <status-message
            state="loading"
            message=${t('status-space-getting', { space: space.name })}
            detail=${progress?.message ?? ''}
          >
            <progress-bar
              label=${t('status-space-getting-label', { space: space.name })}
              .current=${progress?.current}
              .total=${progress?.total}
            ></progress-bar>
          </status-message>
        `
      }
      case 'not-synced':
        return html`
          <status-message
            state="info"
            message=${t('status-space-not-fetched', { space: space.name })}
            detail=${t('status-space-not-fetched-detail')}
          >
            <button class="btn" id="fetch-space" ?disabled=${this._busy} @click=${this._fetch}>
              ${this._busy ? t('action-getting-them') : t('action-get-them-now')}
            </button>
          </status-message>
        `
      default:
        return html`
          <status-message
            state="info"
            message=${t('status-space-no-setlists', { space: space.name })}
            detail=${t('status-space-no-setlists-detail')}
          ></status-message>
        `
    }
  }
}

customElements.define('empty-space', EmptySpace)

declare global {
  interface HTMLElementTagNameMap {
    'empty-space': EmptySpace
  }
}
