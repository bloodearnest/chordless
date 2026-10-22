import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { StoredBlob } from '../js/auth-db.ts'
import type { SignInState, UserInfo } from '../js/google-auth.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles, panelStyles, spinnerStyles } from './shared-styles.ts'

/** Who is signed in now, or what is wrong with the sign-in */
export class AccountStateEvent extends Event {
  static readonly type = 'account-card:state'
  readonly state: SignInState
  constructor(state: SignInState) {
    super(AccountStateEvent.type, { bubbles: true, composed: true })
    this.state = state
  }
}

/** The result of the last sign-in step */
interface Message {
  text: string
  type: 'success' | 'error'
}

/**
 * The account, at the top of Account and Teams (docs/ACCOUNT.md): who is signed in with Google, or
 * that no one is, which is a normal state. Everything else on the page works either way; what the
 * account adds is syncing and teams. Its tools for fixing a sign-in are under "Manage", and the ones
 * only needed when something is wrong (a token refresh test, the sign-in backup) under "Advanced".
 *
 * @fires AccountStateEvent - when it has looked at the sign-in, and whenever that changes
 */
export class AccountCard extends LitElement {
  static override properties = {
    _state: { state: true },
    _user: { state: true },
    _message: { state: true },
  }

  /** Null until the sign-in has been looked at */
  declare _state: SignInState | null
  declare _user: UserInfo | null
  declare _message: Message | null

  _logoutModal: Ref<AppModal> = createRef()

  static override styles = [
    panelStyles,
    buttonStyles,
    spinnerStyles,
    css`
      :host {
        display: block;
      }
      .top {
        display: flex;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .who {
        flex: 1;
        min-width: 12rem;
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: var(--tint, #ddd);
        display: grid;
        place-items: center;
        font-weight: 700;
        object-fit: cover;
      }
      .name { font-weight: 600; display: block; }
      .email, .status { font-size: var(--font-ui-small); opacity: 0.75; display: block; }
      .status.problem { opacity: 1; color: var(--color-danger, #e74c3c); }
      .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; }
      details { margin-top: 1rem; }
      summary { cursor: pointer; font-weight: 600; font-size: var(--font-ui-small); }
      .manage { display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.75rem; }
      .manage .row { display: flex; gap: 0.75rem; flex-wrap: wrap; }
      .advanced { margin-top: 0.5rem; }
      .message { margin: 1rem 0 0; }
      .message.error { color: var(--color-danger, #e74c3c); }
    `,
  ]

  constructor() {
    super()
    this._state = null
    this._user = null
    this._message = null
  }

  override connectedCallback(): void {
    super.connectedCallback()
    void this.refresh()
  }

  /** Look at the sign-in again (the first look, and after anything that changes it) */
  async refresh(): Promise<void> {
    // (neither of these throws: a failed check is a user who is not signed in)
    const { getSignInState, getCurrentUserInfo } = await import('../js/google-auth.ts')
    const state = await getSignInState()
    this._user = state === 'signed-out' ? null : await getCurrentUserInfo()
    this._state = state
    this.dispatchEvent(new AccountStateEvent(state))
  }

  async _signIn(): Promise<void> {
    this._message = null
    try {
      const { authorizeWithGoogle } = await import('../js/google-auth.ts')
      await authorizeWithGoogle()
      await this.refresh()
      this._message =
        this._state === 'no-drive'
          ? {
              text: 'Signed in. Google Drive was not connected, so your own spaces will not sync yet.',
              type: 'success',
            }
          : { text: 'Signed in.', type: 'success' }
    } catch (error) {
      console.error('[AccountCard] Sign-in failed:', error)
      this._message = { text: `Signing in failed: ${errorMessage(error)}`, type: 'error' }
    }
  }

  /** Add Google Drive to a sign-in that has none: Google is asked for that alone */
  async _connectDrive(): Promise<void> {
    this._message = null
    try {
      const { connectDrive } = await import('../js/google-auth.ts')
      await connectDrive()
      await this.refresh()
      this._message =
        this._state === 'no-drive'
          ? { text: 'Google Drive was not connected.', type: 'error' }
          : { text: 'Google Drive connected.', type: 'success' }
    } catch (error) {
      console.error('[AccountCard] Connecting Google Drive failed:', error)
      this._message = {
        text: `Connecting Google Drive failed: ${errorMessage(error)}`,
        type: 'error',
      }
    }
  }

  async _logout(): Promise<void> {
    if (!(await this._logoutModal.value?.ask())) return
    try {
      const { logout } = await import('../js/google-auth.ts')
      const { revoked } = await logout()
      await this.refresh()
      this._message = {
        text: revoked
          ? "Logged out, and Chordless's access to your Drive was revoked."
          : "Logged out on this device, but Google could not be reached to revoke Chordless's access. You can remove it at myaccount.google.com/permissions",
        type: 'success',
      }
    } catch (error) {
      console.error('[AccountCard] Logout failed:', error)
      this._message = { text: `Logging out failed: ${errorMessage(error)}`, type: 'error' }
    }
  }

  async _downloadBackup(): Promise<void> {
    try {
      const { downloadBlobBackup } = await import('../js/google-auth.ts')
      await downloadBlobBackup()
    } catch (error) {
      console.error('[AccountCard] Backup download failed:', error)
      this._message = {
        text: `Downloading the backup failed: ${errorMessage(error)}`,
        type: 'error',
      }
    }
  }

  _importBackup(): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = async event => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const backup = JSON.parse(await file.text())
        const { importBlobBackup } = await import('../js/google-auth.ts')
        await importBlobBackup(backup)
        await this.refresh()
        this._message = { text: 'Sign-in backup imported.', type: 'success' }
      } catch (error) {
        console.error('[AccountCard] Import backup failed:', error)
        this._message = {
          text: `Importing the backup failed: ${errorMessage(error)}`,
          type: 'error',
        }
      }
    }
    input.click()
  }

  /** Make the stored token look expired and ask for a new one: the check that sign-in can be renewed */
  async _testTokenRefresh(): Promise<void> {
    try {
      const { getAccessToken, getStoredBlob } = await import('../js/google-auth.ts')
      const controller = navigator.serviceWorker.controller
      if (!controller) {
        this._message = {
          text: 'The service worker is not active. Reload the page and try again.',
          type: 'error',
        }
        return
      }
      const blobData = await getStoredBlob()
      if (!blobData) {
        this._message = { text: 'Not signed in: sign in with Google first.', type: 'error' }
        return
      }
      const { blob, metadata } = blobData
      const expiredMetadata = {
        ...metadata,
        expires_at: new Date(Date.now() - 60000).toISOString(),
      }
      await new Promise<unknown>((resolve, reject) => {
        const channel = new MessageChannel()
        const messageId = crypto.randomUUID()
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
        channel.port1.onmessage = event => {
          clearTimeout(timeout)
          if (event.data.messageId === messageId) resolve(event.data)
        }
        controller.postMessage(
          { type: 'STORE_BLOB', data: { blob, metadata: expiredMetadata }, messageId },
          [channel.port2]
        )
      })
      await getAccessToken()
      const updated = (await getStoredBlob()) as StoredBlob
      const oldExpiry = new Date(metadata.expires_at as string)
      const newExpiry = new Date(updated.metadata.expires_at as string)
      if (newExpiry <= new Date()) throw new Error('The new token is still expired')
      this._message = {
        text: `Token refresh works: expiry ${oldExpiry.toLocaleTimeString()} → ${newExpiry.toLocaleTimeString()}`,
        type: 'success',
      }
    } catch (error) {
      console.error('[AccountCard] Token refresh test failed:', error)
      const { SignInExpiredError } = await import('../js/google-auth.ts')
      if (error instanceof SignInExpiredError) await this.refresh()
      this._message = { text: `Token refresh failed: ${errorMessage(error)}`, type: 'error' }
    }
  }

  override render() {
    return html`
      <div class="panel">
        <h3>Account</h3>
        ${this._state === null ? html`<p><span class="spinner"></span> Checking…</p>` : this._renderState()}
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
        heading="Log out of Google?"
        confirm-label="Log Out"
        message="This signs you out and revokes Chordless's access to your Google Drive at Google (which needs the network). Other devices signed in with this Google account will need to connect again too. Your songs and setlists stay on this device and in Drive."
      ></app-modal>
    `
  }

  _renderState() {
    const state = this._state as SignInState
    return html`
      <div class="top">
        ${state === 'signed-out' ? this._renderSignedOut() : this._renderWho(state)}
        <div class="actions">${this._renderMainAction(state)}</div>
      </div>
      <details>
        <summary>Manage</summary>
        <div class="manage">
          ${
            state === 'signed-out'
              ? nothing
              : html`<div class="row">
                <button class="btn danger" id="logout" @click=${this._logout}>Log out and revoke access</button>
              </div>`
          }
          <details class="advanced">
            <summary>Advanced</summary>
            <div class="manage">
              <div class="row">
                ${
                  state === 'signed-out'
                    ? nothing
                    : html`<button class="btn" id="test-refresh" @click=${this._testTokenRefresh}>
                      Test token refresh
                    </button>
                    <button class="btn" id="download-backup" @click=${this._downloadBackup}>
                      Download sign-in backup
                    </button>`
                }
                <button class="btn" id="import-backup" @click=${this._importBackup}>
                  Import sign-in backup
                </button>
              </div>
            </div>
          </details>
        </div>
      </details>
    `
  }

  _renderSignedOut() {
    return html`<div class="who">
      <div>
        <span class="name">Not signed in</span>
        <span class="status">
          Your songs and setlists stay on this device. Signing in with Google lets you sync them, share setlists, and join a team.
        </span>
      </div>
    </div>`
  }

  _renderWho(state: SignInState) {
    const user = this._user
    const photo = user?.avatarDataUrl || user?.picture
    const status =
      state === 'expired'
        ? 'Sign-in expired: reconnect to sync'
        : state === 'no-drive'
          ? 'Signed in, Google Drive not connected'
          : 'Google Drive connected'
    return html`<div class="who">
      ${
        photo
          ? html`<img class="avatar" src=${photo} alt="" referrerpolicy="no-referrer" />`
          : html`<div class="avatar" aria-hidden="true">${(user?.name || user?.email || '?').charAt(0).toUpperCase()}</div>`
      }
      <div>
        <span class="name">${user?.name || 'Signed in'}</span>
        ${user?.email ? html`<span class="email">${user.email}</span>` : nothing}
        <span class="status ${state === 'expired' ? 'problem' : ''}" role=${state === 'expired' ? 'alert' : nothing}>
          ${status}
        </span>
      </div>
    </div>`
  }

  _renderMainAction(state: SignInState) {
    if (state === 'signed-out') {
      return html`<button class="btn primary" id="sign-in" @click=${this._signIn}>Sign in with Google</button>`
    }
    if (state === 'expired') {
      return html`<button class="btn primary" id="reconnect" @click=${this._signIn}>Reconnect with Google</button>`
    }
    if (state === 'no-drive') {
      return html`<button class="btn primary" id="connect-drive" @click=${this._connectDrive}>Connect Google Drive</button>`
    }
    return nothing
  }
}
customElements.define('account-card', AccountCard)

declare global {
  interface HTMLElementTagNameMap {
    'account-card': AccountCard
  }
}
