import { html, LitElement } from 'lit'
import './app-modal.js'
import { setlistTitle } from './setlist-info.js'

/**
 * SetlistInfoDialog Component
 *
 * Modal dialog showing a setlist's details, with its date and name as the
 * heading.
 *
 * Usage:
 *   <setlist-info-dialog id="setlist-info-dialog"></setlist-info-dialog>
 *   dialog.show(setlist)
 */
export class SetlistInfoDialog extends LitElement {
  static properties = {
    _setlist: { state: true },
  }

  constructor() {
    super()
    this._setlist = null
  }

  async show(setlist) {
    this._setlist = setlist
    await this.updateComplete
    this.renderRoot.querySelector('app-modal').show()
  }

  close() {
    this.renderRoot?.querySelector('app-modal')?.close()
  }

  render() {
    const heading = this._setlist ? setlistTitle(this._setlist) : 'Setlist info'
    return html`
      <app-modal size="fullscreen" heading=${heading}>
        <setlist-info .setlist=${this._setlist}></setlist-info>
      </app-modal>
    `
  }
}

customElements.define('setlist-info-dialog', SetlistInfoDialog)
