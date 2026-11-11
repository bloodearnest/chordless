import { css, html, LitElement, nothing } from 'lit'
import type { TeamRole } from '../js/team-roles.ts'
import { inviteMessage, inviteSendLinks } from '../js/team-spaces.ts'
import { buttonStyles } from './shared-styles.ts'

/**
 * Hand an invite's link to the person it is for, from the user's own account: the share sheet
 * where the browser has one (WhatsApp, Messages, Mail), else WhatsApp and Gmail's compose window.
 * Chordless sends nothing itself (docs/SPACES.md, "Invites"); the link is already shown to copy.
 */
export class InviteSend extends LitElement {
  static override properties = {
    teamName: { type: String },
    role: { type: String },
    email: { type: String },
    url: { type: String },
  }

  declare teamName: string
  declare role: TeamRole
  declare email: string
  declare url: string

  static override styles = [
    buttonStyles,
    css`:host { display: inline-flex; gap: 0.5rem; flex-wrap: wrap; }`,
  ]

  async _share(): Promise<void> {
    try {
      await navigator.share({
        title: `Join ${this.teamName} on Chordless`,
        text: inviteMessage(this.teamName, this.role, this.email),
        url: this.url,
      })
    } catch {
      // Cancelled, or not allowed: the link is still there to copy
    }
  }

  override render() {
    if (!this.url) return nothing
    if (typeof navigator.share === 'function') {
      return html`<button class="btn" @click=${this._share}>Send…</button>`
    }
    const { whatsapp, gmail } = inviteSendLinks(this.teamName, this.role, this.email, this.url)
    return html`
      <a class="btn" href=${whatsapp} target="_blank" rel="noopener">WhatsApp</a>
      <a class="btn" href=${gmail} target="_blank" rel="noopener">Email (Gmail)</a>
    `
  }
}
customElements.define('invite-send', InviteSend)

declare global {
  interface HTMLElementTagNameMap {
    'invite-send': InviteSend
  }
}
