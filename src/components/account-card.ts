import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import {
  type AccountInfo,
  cachedAccount,
  loadAccount,
  saveAccountName,
} from '../js/account-info.ts'
import type { SignInState, UserInfo } from '../js/google-auth.ts'
import { t } from '../js/text.ts'
import { errorMessage, failedWith } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import './sign-in-form.ts'
import { buttonStyles, panelStyles, spinnerStyles } from './shared-styles.ts'

/** Who is signed in now, or what is wrong with the sign-in */
export class AccountStateEvent extends Event {
  static readonly type = 'account-card:state'
  readonly state: SignInState
  /** Signed in with an emailed code alone: no Google, so a Personal space cannot sync between devices yet */
  readonly emailOnly: boolean
  constructor(state: SignInState, emailOnly = false) {
    super(AccountStateEvent.type, { bubbles: true, composed: true })
    this.state = state
    this.emailOnly = emailOnly
  }
}

/** The result of the last step */
interface Message {
  text: string
  type: 'success' | 'error'
}

/**
 * The account, at the top of Account and Teams (docs/ACCOUNT.md, "The account"): the name they gave, every address they sign
 * in with, whether their Personal space syncs between their devices (which needs a Google account, and has an Enable or Disable
 * button), and Log out. Not being signed in is a normal state, and everything else on the page works either way; what the
 * account adds is syncing and Teams.
 *
 * @fires AccountStateEvent - when it has looked at the sign-in, and whenever that changes
 */
export class AccountCard extends LitElement {
  static override properties = {
    _state: { state: true },
    _user: { state: true },
    _account: { state: true },
    _message: { state: true },
    _emailOnly: { state: true },
    _editingName: { state: true },
    _busy: { state: true },
  }

  /** Null until the sign-in has been looked at */
  declare _state: SignInState | null
  declare _user: UserInfo | null
  /** What the Worker holds of the account: the name and the addresses (as last read, until it answers) */
  declare _account: AccountInfo | null
  declare _message: Message | null
  /** Signed in with an emailed code alone: no Google, so no Drive */
  declare _emailOnly: boolean
  declare _editingName: boolean
  declare _busy: boolean

  _logoutModal: Ref<AppModal> = createRef()
  _disableModal: Ref<AppModal> = createRef()

  static override styles = [
    panelStyles,
    buttonStyles,
    spinnerStyles,
    css`
      :host { display: block; }
      dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.6rem 1rem; margin: 0 0 1rem; align-items: baseline; }
      dt { font-weight: 600; }
      dd { margin: 0; display: flex; gap: 0.5rem 0.75rem; flex-wrap: wrap; align-items: center; min-width: 0; }
      .value { overflow-wrap: anywhere; }
      .sub { font-size: var(--font-ui-small); opacity: 0.75; }
      .problem { opacity: 1; color: var(--color-danger, #e74c3c); }
      .chip { font-size: var(--font-ui-small); padding: 0.05rem 0.5rem; border: 1px solid var(--border-color, #d5dbdb); border-radius: 999px; }
      ul.emails { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
      form.name { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
      form.name input { font: inherit; padding: 0.35rem 0.5rem; min-width: 12rem; }
      .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; }
      .message { margin: 1rem 0 0; }
      .message.error { color: var(--color-danger, #e74c3c); }
    `,
  ]

  constructor() {
    super()
    this._state = null
    this._user = null
    this._account = null
    this._message = null
    this._emailOnly = false
    this._editingName = false
    this._busy = false
  }

  override connectedCallback(): void {
    super.connectedCallback()
    void this.refresh()
  }

  /** Look at the sign-in again (the first look, and after anything that changes it) */
  async refresh(): Promise<void> {
    // (neither of these throws: a failed check is a user who is not signed in)
    const { getSignInState, getCurrentUserInfo, isEmailOnly } = await import('../js/google-auth.ts')
    const state = await getSignInState()
    this._emailOnly = state !== 'signed-out' && (await isEmailOnly())
    this._user = state === 'signed-out' ? null : await getCurrentUserInfo()
    this._account = state === 'signed-out' ? null : cachedAccount()
    this._state = state
    this.dispatchEvent(new AccountStateEvent(state, this._emailOnly))
    // (what the Worker says is newer than what was kept: shown when it comes, and kept for offline)
    if (state !== 'signed-out') {
      const fresh = await loadAccount()
      if (fresh) this._account = fresh
    }
  }

  /** They signed in (by a code or Google, on the form): look again, and say so */
  async _signedInHere(): Promise<void> {
    await this.refresh()
    this._message =
      this._state === 'no-drive'
        ? { text: t('account-signed-in-no-drive'), type: 'success' }
        : { text: t('account-signed-in'), type: 'success' }
  }

  /** Google's whole sign-in: to sign in, to reconnect, and to turn the Personal space's sync on for an emailed sign-in */
  async _signIn(): Promise<void> {
    this._message = null
    try {
      const { authorizeWithGoogle } = await import('../js/google-auth.ts')
      await authorizeWithGoogle()
      await this.refresh()
      this._message =
        this._state === 'no-drive'
          ? { text: t('account-signed-in-no-drive'), type: 'success' }
          : { text: t('account-signed-in'), type: 'success' }
    } catch (error) {
      console.error('[AccountCard] Sign-in failed:', error)
      this._message = {
        text: failedWith(
          error,
          t('account-signin-failed', { reason: errorMessage(error) }),
          t('account-signin-failed-plain')
        ),
        type: 'error',
      }
    }
  }

  /** Add Google Drive to a Google sign-in that has none: Google is asked for that alone */
  async _connectDrive(): Promise<void> {
    this._message = null
    try {
      const { connectDrive } = await import('../js/google-auth.ts')
      await connectDrive()
      await this.refresh()
      this._message =
        this._state === 'no-drive'
          ? { text: t('account-drive-not-connected'), type: 'error' }
          : { text: t('account-drive-connected'), type: 'success' }
    } catch (error) {
      console.error('[AccountCard] Connecting Google Drive failed:', error)
      this._message = {
        text: failedWith(
          error,
          t('account-drive-connect-failed', { reason: errorMessage(error) }),
          t('account-drive-connect-failed-plain')
        ),
        type: 'error',
      }
    }
  }

  /** Turn the Personal space's sync off on this device, after a question: they stay signed in */
  async _disableSync(): Promise<void> {
    if (!(await this._disableModal.value?.ask())) return
    try {
      const { disconnectDrive } = await import('../js/google-auth.ts')
      const { revoked } = await disconnectDrive()
      await this.refresh()
      this._message = {
        text: t(revoked ? 'account-sync-disabled' : 'account-sync-disabled-grant-kept'),
        type: 'success',
      }
    } catch (error) {
      console.error('[AccountCard] Turning the sync off failed:', error)
      this._message = {
        text: failedWith(
          error,
          t('account-sync-disable-failed', { reason: errorMessage(error) }),
          t('account-sync-disable-failed-plain')
        ),
        type: 'error',
      }
    }
  }

  async _logout(): Promise<void> {
    if (!(await this._logoutModal.value?.ask())) return
    try {
      const { logout } = await import('../js/google-auth.ts')
      await logout()
      await this.refresh()
      this._message = { text: t('account-logged-out'), type: 'success' }
    } catch (error) {
      console.error('[AccountCard] Logout failed:', error)
      this._message = {
        text: failedWith(
          error,
          t('account-logout-failed', { reason: errorMessage(error) }),
          t('account-logout-failed-plain')
        ),
        type: 'error',
      }
    }
  }

  /** The name they give for themselves, kept at the Worker */
  async _saveName(event: Event): Promise<void> {
    event.preventDefault()
    const input = (event.target as HTMLFormElement).elements.namedItem('name') as HTMLInputElement
    this._busy = true
    this._message = null
    try {
      this._account = await saveAccountName(input.value)
      this._editingName = false
    } catch (error) {
      console.error('[AccountCard] Saving the name failed:', error)
      this._message = {
        text: failedWith(
          error,
          t('account-name-save-failed', { reason: errorMessage(error) }),
          t('account-name-save-failed-plain')
        ),
        type: 'error',
      }
    } finally {
      this._busy = false
    }
  }

  /** The name to show: the one they gave, else the one their sign-in said, else none */
  get _name(): string | null {
    return this._account?.name ?? null
  }

  /** The addresses to show: the account's (as last read), else the one this device is signed in with */
  get _emails(): { email: string; provider: string }[] {
    if (this._account?.emails.length) return this._account.emails
    const email = this._user?.email
    return email ? [{ email, provider: this._emailOnly ? 'email' : 'google' }] : []
  }

  override render() {
    return html`
      <div class="panel">
        <h3>${t('account-heading')}</h3>
        ${this._state === null ? html`<p><span class="spinner"></span> ${t('status-checking')}</p>` : this._renderState()}
        ${
          this._message
            ? html`<p
                class="message ${this._message.type}"
                role=${this._message.type === 'error' ? 'alert' : 'status'}
              >
                ${this._message.text}
              </p>`
            : nothing
        }
      </div>
      <app-modal
        ${ref(this._logoutModal)}
        type="confirm"
        size="small"
        heading=${t('confirm-logout-heading')}
        confirm-label=${t('confirm-logout-button')}
        message=${t('confirm-logout-message')}
      ></app-modal>
      <app-modal
        ${ref(this._disableModal)}
        type="confirm"
        size="small"
        heading=${t('confirm-sync-disable-heading')}
        confirm-label=${t('confirm-sync-disable-button')}
        message=${t('confirm-sync-disable-message')}
      ></app-modal>
    `
  }

  _renderState() {
    const state = this._state as SignInState
    if (state === 'signed-out') return this._renderSignedOut()
    return html`
      <dl>
        <dt>${t('account-name-label')}</dt>
        <dd>${this._renderName()}</dd>
        <dt>${t('account-emails-label')}</dt>
        <dd>${this._renderEmails()}</dd>
        <dt>${t('account-sync-label')}</dt>
        <dd>${this._renderSync(state)}</dd>
      </dl>
      <div class="actions">
        <button class="btn" id="logout" @click=${this._logout}>${t('account-logout')}</button>
      </div>
    `
  }

  _renderSignedOut() {
    return html`
      <p>
        <strong>${t('account-signed-out-name')}</strong>
        <span class="sub">${t('account-signed-out-text')}</span>
      </p>
      <sign-in-form @email-code:signed-in=${this._signedInHere}></sign-in-form>
    `
  }

  _renderName() {
    if (this._editingName) {
      return html`<form class="name" @submit=${this._saveName}>
        <input
          name="name"
          aria-label=${t('account-name-label')}
          autocomplete="name"
          maxlength="100"
          required
          .value=${this._name ?? this._user?.name ?? ''}
        />
        <button class="btn primary" type="submit" ?disabled=${this._busy}>${t('action-save')}</button>
        <button class="btn" type="button" ?disabled=${this._busy} @click=${() => (this._editingName = false)}>${t('action-cancel')}</button>
      </form>`
    }
    return html`
      ${
        this._name
          ? html`<span class="value" id="account-name">${this._name}</span>`
          : html`<span class="sub" id="account-name">${t('account-name-none')}</span>`
      }
      <button class="btn" id="edit-name" @click=${() => (this._editingName = true)}>
        ${this._name ? t('action-edit') : t('account-name-add')}
      </button>
    `
  }

  _renderEmails() {
    const emails = this._emails
    if (emails.length === 0) return html`<span class="sub">${t('account-emails-none')}</span>`
    return html`<ul class="emails">
      ${emails.map(
        each => html`<li>
          <span class="value">${each.email}</span>
          ${each.provider === 'google' ? html`<span class="chip">${t('account-email-google')}</span>` : nothing}
        </li>`
      )}
    </ul>`
  }

  /** Whether the Personal space syncs, and the one button that changes it */
  _renderSync(state: SignInState) {
    if (state === 'expired') {
      return html`
        <span class="problem" role="alert">${t('account-status-expired')}</span>
        <button class="btn primary" id="reconnect" @click=${this._signIn}>${t('action-reconnect-google')}</button>
      `
    }
    if (state === 'signed-in') {
      return html`
        <span class="value">${t('account-sync-on', { email: this._user?.email ?? '' })}</span>
        <button class="btn" id="disable-sync" @click=${this._disableSync}>${t('action-disable')}</button>
      `
    }
    // (signed in with no Drive: by an emailed code alone, or by Google without Drive's box ticked)
    return html`
      <span class="sub">${t(this._emailOnly ? 'account-sync-off-email' : 'account-sync-off-drive')}</span>
      <button
        class="btn primary"
        id="enable-sync"
        @click=${this._emailOnly ? this._signIn : this._connectDrive}
      >${t('action-enable')}</button>
    `
  }
}
customElements.define('account-card', AccountCard)

declare global {
  interface HTMLElementTagNameMap {
    'account-card': AccountCard
  }
}
