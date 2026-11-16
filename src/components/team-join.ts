import { css, html, LitElement, nothing } from 'lit'
import type { Space, TeamLink } from '../js/data-types.ts'
import {
  authorizeWithGoogle,
  getCurrentUserInfo,
  getSignInState,
  SignInExpiredError,
} from '../js/google-auth.ts'
import { IncomingLinkEvent, takeLink } from '../js/incoming-link.ts'
import { type JoinDevice, joinDevice } from '../js/join-device.ts'
import { JoinTrail } from '../js/join-telemetry.ts'
import { matchRoute, type Route } from '../js/router.ts'
import { setCurrentSpace, switchSpace } from '../js/space.ts'
import { storageFor } from '../js/storage/space-storage.ts'
import type { ProgressCallback, SyncProgress } from '../js/sync-manager.ts'
import { type InviteLookup, teamApi } from '../js/team-client.ts'
import {
  googleAccountGuideUrl,
  joinSpace,
  roleWithArticle,
  syncTeamSpace,
} from '../js/team-spaces.ts'
import { t } from '../js/text.ts'
import { errorMessage } from '../js/utils/errors.ts'
import { TeamError } from '../js/worker-call.ts'
import './progress-bar.ts'
import { buttonStyles } from './shared-styles.ts'

type State =
  | 'bad-link'
  | 'not-valid'
  | 'checking'
  | 'sign-in'
  | 'make-account'
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

/** Where an answer to "do you have a Google account?" is kept for an invite, as they leave to make one and come back */
const answerKey = (teamId: string) => `chordless:join-has-google:${teamId}`

function readAnswer(teamId: string): 'yes' | 'no' | null {
  try {
    const answer = localStorage.getItem(answerKey(teamId))
    return answer === 'yes' || answer === 'no' ? answer : null
  } catch {
    return null
  }
}

function keepAnswer(teamId: string, answer: 'yes' | 'no'): void {
  try {
    localStorage.setItem(answerKey(teamId), answer)
  } catch {
    // (not kept: they are asked again)
  }
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
    _answer: { state: true },
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
  /** Whether they said they have a Google account, kept for the invite while they go and make one */
  declare _answer: 'yes' | 'no' | null
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
    this._answer = null
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
    this._answer = readAnswer(invite.teamId)
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
      // (an expired sign-in was one they made: they have a Google account, so they are not asked)
      if (state === 'expired') this._answer = 'yes'
      this._state = 'sign-in'
      return
    }
    this._email = (await getCurrentUserInfo())?.email ?? null
    this._trail.note({ 'chordless.join.signed_in_as_invited': this._asInvited() })
    this._state = 'ready'
  }

  /** What they know about having a Google account, and so what to ask: yes, no, or nothing said (a phone has one) */
  _hasGoogle(): 'assumed' | 'yes' | 'no' | 'unknown' {
    const info = this._info
    if (info?.role === 'admin' || info?.google === 'gmail' || info?.google === 'workspace') {
      return 'assumed'
    }
    if (this.device.os === 'android') return 'assumed'
    return this._answer ?? 'unknown'
  }

  _answerHasGoogle(answer: 'yes' | 'no'): void {
    this._answer = answer
    keepAnswer((this._invite as { teamId: string }).teamId, answer)
    this._state = answer === 'yes' ? 'sign-in' : 'make-account'
  }

  async _copyLink(): Promise<void> {
    try {
      await this.copyText(window.location.href)
      this._copied = true
    } catch {
      this._copied = false
    }
  }

  /** Sign in with Google for who they are alone, then look again */
  async _signIn(): Promise<void> {
    this._trail.note({ 'chordless.join.has_google_answer': this._hasGoogle() })
    try {
      await authorizeWithGoogle({ drive: false })
    } catch (error) {
      this._trail.note({
        'chordless.join.sign_in_error': error instanceof Error ? error.name : 'unknown',
      })
      this._message = errorMessage(error)
      this._state = 'failed'
      return
    }
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
      this._message = this._explain(error)
      if (error instanceof SignInExpiredError) this._answer = 'yes'
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
      this._syncError = this._explain(error)
    }
    this._progress = null
    this._state = 'joined'
  }

  /** What to tell them of a refusal */
  _explain(error: unknown): string {
    if (error instanceof TeamError && error.status === 403) {
      return `This invite was sent to a different Google account${
        this._email ? `, not ${this._email}` : ''
      }. Sign in with the address it was sent to.`
    }
    if (error instanceof TeamError && error.status === 404) {
      return t('join-not-valid')
    }
    return errorMessage(error)
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
    const known = this._hasGoogle()
    // (one who said they need an account is asked again: they may have made one since)
    const question = known === 'unknown' || known === 'no'
    let guidance: string
    if (info?.role === 'admin') guidance = t('join-admin-exact', { email })
    else if (info?.google === 'gmail' || info?.google === 'workspace') {
      guidance = t('join-sign-in-invited', { email })
    } else if (this.device.os === 'android') {
      guidance = info ? t('join-sign-in-android', { email }) : t('join-sign-in-any-nameless')
    } else {
      guidance = info ? t('join-sign-in-any', { email }) : t('join-sign-in-any-nameless')
    }
    return html`
      <h2>${heading}</h2>
      ${
        question
          ? html`
              <p>${t('join-has-google-question')}</p>
              ${this._message ? html`<p class="status error" role="alert">${this._message}</p>` : nothing}
              <div class="actions">
                <button class="btn primary" @click=${() => this._answerHasGoogle('yes')}>
                  ${t('join-has-google-yes')}
                </button>
                <button class="btn" @click=${() => this._answerHasGoogle('no')}>
                  ${t('join-has-google-no')}
                </button>
              </div>
            `
          : html`
              <p>${guidance}</p>
              ${this._message ? html`<p class="status error" role="alert">${this._message}</p>` : nothing}
              <div class="actions">
                <button class="btn primary" @click=${this._signIn}>🔑 ${t('join-sign-in-button')}</button>
                ${
                  known === 'yes'
                    ? html`<button class="btn" @click=${() => this._answerHasGoogle('no')}>
                        ${t('join-has-google-no')}
                      </button>`
                    : nothing
                }
              </div>
            `
      }
    `
  }

  /** For someone with no Google account: the easy way, and the way that keeps their own address */
  _renderMakeAccount() {
    const email = this._info?.email
    return html`
      <h2>${t('join-make-heading')}</h2>
      <p>${t('join-make-easiest')}</p>
      <p>
        <a href="https://accounts.google.com/signup" target="_blank" rel="noopener">${t('join-make-open-signup')}</a>
      </p>
      ${
        email
          ? html`<p class="hint">
              ${t('join-make-existing', { email })}
              <a href=${googleAccountGuideUrl(window.location.origin)}>${t('join-make-guide-link')}</a>
            </p>`
          : nothing
      }
      <div class="actions">
        <button class="btn primary" @click=${() => this._answerHasGoogle('yes')}>
          ${t('join-make-done')}
        </button>
        <button class="btn" @click=${() => (this._state = 'sign-in')}>${t('join-make-back')}</button>
      </div>
    `
  }

  /** Signed in: who they are, whether it is the address the invite was sent to, and the choice to join */
  _renderReady() {
    const info = this._info
    const mismatch = Boolean(info && this._email && !this._asInvited())
    const locked = mismatch && info?.role === 'admin'
    return html`
      <h2>Join a team space</h2>
      <p>
        You are signed in${this._email ? html` as <span class="who">${this._email}</span>` : nothing}.
        Joining adds the team's songs and setlists to this device, and keeps them in step with the
        team's.
      </p>
      ${
        locked
          ? html`<p class="status error" role="alert">${t('join-admin-exact', { email: info?.email ?? '' })}</p>`
          : mismatch
            ? html`<p class="hint">${t('join-as-other', { invited: info?.email ?? '', email: this._email ?? '' })}</p>`
            : nothing
      }
      <div class="actions">
        ${
          locked
            ? nothing
            : html`<button class="btn primary" @click=${this._join}>Join the team space</button>`
        }
        <button class="btn ${locked ? 'primary' : ''}" @click=${this._signIn}>Use a different account</button>
      </div>
    `
  }

  _renderState() {
    switch (this._state) {
      case 'bad-link':
        return html`
          <h2>This link doesn't work</h2>
          <p class="status error" role="alert">
            It is missing part of the invite, which can happen if it was cut short. Ask the person who
            sent it to send it again.
          </p>
        `
      case 'checking':
        return html`<p class="status" role="status">${t('status-checking')}</p>`
      case 'not-valid':
        return html`
          <h2>This invite doesn't work</h2>
          <p class="status error" role="alert">${t('join-not-valid')}</p>
        `
      case 'sign-in':
        return this._renderSignIn()
      case 'make-account':
        return this._renderMakeAccount()
      case 'ready':
        return this._renderReady()
      case 'joining':
        return html`<p class="status" role="status">Joining…</p>`
      case 'syncing':
        return html`
          <p class="status" role="status">
            ${this._progress?.message ?? "Getting the team's songs and setlists…"}
          </p>
          <progress-bar
            label="Getting the team's songs and setlists"
            .current=${this._progress?.current}
            .total=${this._progress?.total}
          ></progress-bar>
        `
      case 'joined':
        return html`
          <h2>You have joined ${this._joined?.name}</h2>
          <p>
            The space is on this device, and you are in it as ${this._role}.
            ${
              this._syncError
                ? "The team's songs and setlists have not come across yet. Open the space and sync to try again."
                : "The team's songs and setlists are here."
            }
          </p>
          ${this._syncError ? html`<p class="status error" role="alert">${this._syncError}</p>` : nothing}
          <div class="actions">
            ${this._syncError ? html`<button class="btn" @click=${this._sync}>Try again</button>` : nothing}
            <button class="btn primary" @click=${this._open}>Open ${this._joined?.name}</button>
          </div>
        `
      case 'failed':
        return html`
          <h2>Couldn't join</h2>
          <p class="status error" role="alert">${this._message}</p>
          ${
            this._info?.role === 'admin'
              ? html`<p class="hint">${t('join-admin-exact', { email: this._info.email })}</p>`
              : nothing
          }
          <div class="actions">
            <button class="btn primary" @click=${this._check}>Try again</button>
            <button class="btn" @click=${this._signIn}>Use a different account</button>
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
