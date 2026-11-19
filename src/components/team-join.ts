import { css, html, LitElement, nothing } from 'lit'
import type { Space, TeamLink } from '../js/data-types.ts'
import {
  getCurrentUserInfo,
  getSignInState,
  logout,
  SignInExpiredError,
} from '../js/google-auth.ts'
import { IncomingLinkEvent, takeLink } from '../js/incoming-link.ts'
import { type JoinDevice, joinDevice } from '../js/join-device.ts'
import { JoinTrail } from '../js/join-telemetry.ts'
import { rich } from '../js/rich-text.ts'
import { matchRoute, type Route } from '../js/router.ts'
import { setCurrentSpace, switchSpace } from '../js/space.ts'
import { storageFor } from '../js/storage/space-storage.ts'
import type { ProgressCallback, SyncProgress } from '../js/sync-manager.ts'
import { type InviteLookup, teamApi } from '../js/team-client.ts'
import { joinSpace, roleWithArticle, syncTeamSpace } from '../js/team-spaces.ts'
import { t } from '../js/text.ts'
import { whatToSay } from '../js/utils/errors.ts'
import { TeamError } from '../js/worker-call.ts'
import './sign-in-form.ts'
import './progress-bar.ts'
import { buttonStyles } from './shared-styles.ts'

type State =
  | 'bad-link'
  | 'not-valid'
  | 'checking'
  | 'sign-in'
  | 'ready'
  | 'joining'
  | 'syncing'
  | 'joined'
  | 'failed'

/** The space and the invite's code, from an older link's fragment: `#<space id>.<code>` */
export function parseInvite(fragment: string): { teamId: string; code: string } | null {
  const match = /^#?([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{16,64})$/.exec(fragment)
  return match ? { teamId: match[1], code: match[2] } : null
}

/**
 * Join a team space (docs/SPACES.md, "Setting up and joining a team space") with the link an admin
 * sent: /join/<space id>/<code> (links sent before that have them in the fragment, #<space id>.<code>). The person signs in with Google if they have not (for who they
 * are only: Chordless asks for no access to their Drive), is shown who they are signed in as, and
 * chooses to join. The invite's address is a label, not a lock (an admin invite excepted): any Google
 * account will do, and the page says so, and guides someone who has none. What it says depends on what the
 * Worker says the invite is for (`lookupInvite`), and on the device: an Android phone has a Google account,
 * a page inside another app's browser must be opened in the real one. Once joined, the space is on this
 * device and opening it starts the app afresh. Where people stop is a span (`JoinTrail`).
 */
export class TeamJoin extends LitElement {
  static override properties = {
    _state: { state: true },
    _email: { state: true },
    _message: { state: true },
    _joined: { state: true },
    _role: { state: true },
    _syncError: { state: true },
    _progress: { state: true },
    _info: { state: true },
    _continueHere: { state: true },
    _copied: { state: true },
    route: { attribute: false },
  }

  declare _state: State
  declare _email: string | null
  /** What went wrong, for 'failed' */
  declare _message: string
  declare _joined: Space | null
  /** Their role in it, for 'joined' */
  declare _role: string
  /** Why the first sync did not work, if it did not */
  declare _syncError: string
  /** How far the first sync has got, while it runs */
  declare _progress: SyncProgress | null
  /** What the invite is for, as the Worker says; undefined where it could not be asked */
  declare _info: InviteLookup | undefined
  /** They chose to carry on inside another app's browser */
  declare _continueHere: boolean
  declare _copied: boolean
  /** The page's route (the address, if the page does not say), which holds the invite in a new link */
  declare route: Route | undefined

  /** Shows the space once it is the one in use (a test gives its own; by default the home page, afresh) */
  show: (() => unknown) | undefined = undefined
  /** Gets the team's files for the space just joined, saying how far it has got (a test gives its own) */
  syncSpace: (space: Space, onProgress?: ProgressCallback) => Promise<void> = syncTeamSpace
  /** What an invite is for (a test gives its own) */
  lookupInvite: (spaceId: string, code: string) => Promise<InviteLookup | null> = (spaceId, code) =>
    teamApi.lookupInvite(spaceId, code)
  /** The device, read once (a test gives its own) */
  device: JoinDevice = joinDevice()
  /** Copies the invite's link (a test gives its own) */
  copyText: (text: string) => Promise<void> = text => navigator.clipboard.writeText(text)
  /** The invite, once the link is read */
  _invite: { teamId: string; code: string } | null = null
  /** What happened here, for the span that says where people stop */
  _trail = new JoinTrail()
  /** The link's fragment (a test gives its own) */
  // biome-ignore lint/plugin: the invite is the link's fragment (not a route)
  fragment: string = window.location.hash

  static override styles = [
    buttonStyles,
    css`
    :host { display: block; flex: 1; min-height: 0; overflow-y: auto; color: var(--text-color); }
    .page { max-width: 600px; margin: 0 auto; padding: 2rem 1rem; }
    h2 { margin: 0 0 1rem; font-size: var(--font-ui); }
    .status { color: var(--text-secondary, #5f6b6d); }
    .status.error { color: var(--color-danger, #e74c3c); }
    .who { font-weight: 600; }
    .hint { color: var(--text-muted, inherit); font-size: 0.9em; }
    .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 1.5rem; }
    `,
  ]

  constructor() {
    super()
    this._state = 'checking'
    this._email = null
    this._message = ''
    this._joined = null
    this._role = ''
    this._syncError = ''
    this._progress = null
    this._info = undefined
    this._continueHere = false
    this._copied = false
  }

  override connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener(IncomingLinkEvent.type, this._onLink)
    window.addEventListener('hashchange', this._onHash)
    window.addEventListener('pagehide', this._onLeave)
    // (an older link's fragment: the installed app is given it, launch.ts; a tab keeps it in the address)
    this._read(takeLink('/join') ?? this.fragment)
  }

  override disconnectedCallback(): void {
    window.removeEventListener(IncomingLinkEvent.type, this._onLink)
    window.removeEventListener('hashchange', this._onHash)
    window.removeEventListener('pagehide', this._onLeave)
    this._onLeave()
    super.disconnectedCallback()
  }

  override willUpdate(changed: Map<string, unknown>): void {
    // Another invite link opened while this page is: the route changes, the page stays
    if (this.hasUpdated && changed.has('route')) this._read(this.fragment)
    if (changed.has('_state')) this._noteState()
  }

  /** The page was left or closed without joining or reaching a dead end */
  _onLeave = (): void => {
    this._trail.end(this._needsAdminAddress() ? 'needs_admin_address' : 'abandoned')
  }

  /** An admin invite, and they are not signed in as the address it was sent to */
  _needsAdminAddress(): boolean {
    return this._info?.role === 'admin' && this._email !== null && !this._asInvited()
  }

  /** Whether they are signed in as the address the invite was sent to */
  _asInvited(): boolean {
    return Boolean(
      this._info && this._email && this._email.toLowerCase() === this._info.email.toLowerCase()
    )
  }

  /** The step the page is on is the trail's; the ends of the visit end it */
  _noteState(): void {
    this._trail.step(this._state)
    if (this._state === 'joined') this._trail.end('joined')
    else if (this._state === 'bad-link') this._trail.end('bad_link')
    else if (this._state === 'not-valid') this._trail.end('not_valid')
  }

  /** An invite the installed app was launched with while this page is open */
  _onLink = (): void => {
    const fragment = takeLink('/join')
    if (fragment) this._read(fragment)
  }

  /** Another invite link opened in the tab this page is in */
  _onHash = (): void => {
    // biome-ignore lint/plugin: the invite is the link's fragment (not a route)
    this._read(window.location.hash)
  }

  /** Take the invite in a link's fragment, and see where they stand */
  _read(fragment: string): void {
    this.fragment = fragment
    const route = this.route ?? matchRoute(window.location)
    this._invite =
      route.name === 'join' && route.teamId && route.code
        ? { teamId: route.teamId, code: route.code }
        : parseInvite(fragment)
    this._message = ''
    this._trail.end('abandoned')
    this._trail = new JoinTrail()
    this._info = undefined
    this._continueHere = false
    if (this._invite) void this._start()
    else this._state = 'bad-link'
  }

  /** Ask what the invite is for, then see whether they are signed in */
  async _start(): Promise<void> {
    const invite = this._invite as { teamId: string; code: string }
    this._state = 'checking'
    try {
      const info = await this.lookupInvite(invite.teamId, invite.code)
      if (!info) {
        this._state = 'not-valid'
        return
      }
      this._info = info
      this._trail.note({
        'chordless.join.role': info.role,
        'chordless.join.invite_google': info.google,
      })
    } catch {
      // (offline, or too many tries: they can still sign in and join, just without the welcome)
      this._trail.note({ 'chordless.join.invite_google': 'none' })
    }
    this._trail.note({ 'chordless.join.in_app_browser': this.device.inAppBrowser ?? 'none' })
    await this._check()
  }

  /** Whether they are signed in, and as whom */
  async _check(): Promise<void> {
    this._state = 'checking'
    const state = await getSignInState()
    if (state === 'signed-out' || state === 'expired') {
      this._state = 'sign-in'
      return
    }
    this._email = (await getCurrentUserInfo())?.email ?? null
    this._trail.note({ 'chordless.join.signed_in_as_invited': this._asInvited() })
    this._state = 'ready'
  }

  async _copyLink(): Promise<void> {
    try {
      await this.copyText(window.location.href)
      this._copied = true
    } catch {
      this._copied = false
    }
  }

  /** Sign in as someone else: this sign-in is left (signing in over it would only add a login to the same account) */
  async _differentAccount(): Promise<void> {
    await logout()
    this._email = null
    this._state = 'sign-in'
  }

  /** They signed in (by a code or Google): look again */
  async _signedIn(): Promise<void> {
    this._trail.note({ 'chordless.join.method': 'signed_in' })
    await this._check()
  }

  async _join(): Promise<void> {
    const invite = this._invite as { teamId: string; code: string }
    this._state = 'joining'
    try {
      const joined = await joinSpace(
        invite.teamId,
        invite.code,
        storageFor({ team: { id: invite.teamId, role: 'reader' } })
      )
      this._joined = joined
      // The team is the space in use from now (and first among the tabs), whether or not they open it here
      await setCurrentSpace(joined.id, joined.name)
      this._role = roleWithArticle((joined.team as TeamLink).role)
    } catch (error) {
      this._message = this._explain(error, t('join-failed'))
      this._state = error instanceof SignInExpiredError ? 'sign-in' : 'failed'
      return
    }
    await this._sync()
  }

  /** The first sync: the team's songs and setlists come to this device (they are joined either way) */
  async _sync(): Promise<void> {
    this._state = 'syncing'
    this._syncError = ''
    this._progress = null
    try {
      await this.syncSpace(this._joined as Space, progress => {
        this._progress = progress
      })
    } catch (error) {
      this._syncError = this._explain(error, t('join-sync-failed'))
    }
    this._progress = null
    this._state = 'joined'
  }

  /** What to tell them of a refusal */
  _explain(error: unknown, what: string): string {
    if (error instanceof TeamError && error.status === 403) {
      return this._email
        ? t('join-wrong-account-not', { email: this._email })
        : t('join-wrong-account')
    }
    if (error instanceof TeamError && error.status === 404) {
      return t('join-not-valid')
    }
    return whatToSay(error, what)
  }

  /** The space is on this device: start the app afresh in it */
  _open(): void {
    if (this._joined) void switchSpace(this._joined.id, this.show)
  }

  override render() {
    return html`<div class="page">${this._renderState()}</div>`
  }

  /** The sign-in step: welcome, then what to do depending on the device and what is known of the address */
  _renderSignIn() {
    const info = this._info
    const heading = info
      ? t('join-welcome-heading', { team: info.teamName, role: roleWithArticle(info.role) })
      : t('join-welcome-unknown')
    if (this.device.inAppBrowser && !this._continueHere) {
      return html`
        <h2>${heading}</h2>
        <h3>${t('join-in-app-heading')}</h3>
        <p>${t('join-in-app-body', { app: this.device.inAppBrowser })}</p>
        <div class="actions">
          <button class="btn primary" @click=${this._copyLink}>
            ${this._copied ? t('join-link-copied') : t('join-copy-link')}
          </button>
          <button class="btn" @click=${() => (this._continueHere = true)}>
            ${t('join-continue-here')}
          </button>
        </div>
      `
    }
    const email = info?.email ?? ''
    return html`
      <h2>${heading}</h2>
      <p>${info?.role === 'admin' ? t('join-admin-exact', { email }) : t('join-sign-in-intro')}</p>
      ${this._message ? html`<p class="status error" role="alert">${this._message}</p>` : nothing}
      <sign-in-form
        .address=${email}
        .next=${window.location.pathname + window.location.search}
        @email-code:signed-in=${this._signedIn}
      ></sign-in-form>
    `
  }

  /** Signed in: who they are, whether it is the address the invite was sent to, and the choice to join */
  _renderReady() {
    // (the invite, when they are signed in as another address than the one it was sent to)
    const other = this._info && this._email && !this._asInvited() ? this._info : null
    const locked = other?.role === 'admin'
    return html`
      <h2>${t('page-join')}</h2>
      <p>
        ${
          this._email
            ? rich(
                'join-signed-in-as',
                { email: this._email },
                { who: words => html`<span class="who">${words}</span>` }
              )
            : t('join-signed-in')
        }
        ${t('join-adds')}
      </p>
      ${
        other && locked
          ? html`<p class="status error" role="alert">${t('join-admin-exact', { email: other.email })}</p>`
          : other
            ? html`<p class="hint">${t('join-as-other', { invited: other.email, email: this._email as string })}</p>`
            : nothing
      }
      <div class="actions">
        ${
          locked
            ? nothing
            : html`<button class="btn primary" @click=${this._join}>${t('join-button')}</button>`
        }
        <button class="btn ${locked ? 'primary' : ''}" @click=${this._differentAccount}>${t('join-different-account')}</button>
      </div>
    `
  }

  /** The name of the Team just joined (the page shows it only once there is one) */
  get _joinedName(): string {
    return (this._joined as Space).name
  }

  _renderState() {
    switch (this._state) {
      case 'bad-link':
        return html`
          <h2>${t('join-bad-link')}</h2>
          <p class="status error" role="alert">${t('join-bad-link-text')}</p>
        `
      case 'checking':
        return html`<p class="status" role="status">${t('status-checking')}</p>`
      case 'not-valid':
        return html`
          <h2>${t('join-invalid')}</h2>
          <p class="status error" role="alert">${t('join-not-valid')}</p>
        `
      case 'sign-in':
        return this._renderSignIn()
      case 'ready':
        return this._renderReady()
      case 'joining':
        return html`<p class="status" role="status">${t('join-joining')}</p>`
      case 'syncing':
        return html`
          <p class="status" role="status">
            ${this._progress?.message ?? t('join-getting')}
          </p>
          <progress-bar
            label=${t('join-getting-label')}
            .current=${this._progress?.current}
            .total=${this._progress?.total}
          ></progress-bar>
        `
      case 'joined':
        return html`
          <h2>${t('join-joined', { name: this._joinedName })}</h2>
          <p>
            ${t('join-joined-text', { role: this._role })}
            ${t(this._syncError ? 'join-not-synced' : 'join-synced')}
          </p>
          ${this._syncError ? html`<p class="status error" role="alert">${this._syncError}</p>` : nothing}
          <div class="actions">
            ${this._syncError ? html`<button class="btn" @click=${this._sync}>${t('action-try-again')}</button>` : nothing}
            <button class="btn primary" @click=${this._open}>${t('wizard-open', { name: this._joinedName })}</button>
          </div>
        `
      case 'failed':
        return html`
          <h2>${t('join-failed-heading')}</h2>
          <p class="status error" role="alert">${this._message}</p>
          ${
            this._info?.role === 'admin'
              ? html`<p class="hint">${t('join-admin-exact', { email: this._info.email })}</p>`
              : nothing
          }
          <div class="actions">
            <button class="btn primary" @click=${this._check}>${t('action-try-again')}</button>
            <button class="btn" @click=${this._differentAccount}>${t('join-different-account')}</button>
          </div>
        `
    }
  }
}
customElements.define('team-join', TeamJoin)

declare global {
  interface HTMLElementTagNameMap {
    'team-join': TeamJoin
  }
}
