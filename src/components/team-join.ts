import { css, html, LitElement, nothing } from 'lit'
import type { Space, TeamLink } from '../js/data-types.ts'
import {
  authorizeWithGoogle,
  getCurrentUserInfo,
  getSignInState,
  SignInExpiredError,
} from '../js/google-auth.ts'
import { IncomingLinkEvent, takeLink } from '../js/incoming-link.ts'
import { switchSpace } from '../js/space.ts'
import { storageFor } from '../js/storage/space-storage.ts'
import { TeamError } from '../js/team-client.ts'
import { joinSpace } from '../js/team-spaces.ts'
import { errorMessage } from '../js/utils/errors.ts'
import { buttonStyles } from './shared-styles.ts'

type State = 'bad-link' | 'checking' | 'sign-in' | 'ready' | 'joining' | 'joined' | 'failed'

/** The space and the invite's code, from the link's fragment: `#<space id>.<code>` */
export function parseInvite(fragment: string): { teamId: string; code: string } | null {
  const match = /^#?([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{16,64})$/.exec(fragment)
  return match ? { teamId: match[1], code: match[2] } : null
}

/**
 * Join a team space (docs/SPACES.md, "Setting up and joining a team space") with the link an admin
 * sent: /join#<space id>.<code>. The person signs in with Google if they have not (for who they
 * are only: Chordless asks for no access to their Drive), is shown who they are signed in as, and
 * chooses to join. The invite is for one email address, so a different account is told so and can
 * sign in again. Once joined, the space is on this device and opening it starts the app afresh.
 */
export class TeamJoin extends LitElement {
  static override properties = {
    _state: { state: true },
    _email: { state: true },
    _message: { state: true },
    _joined: { state: true },
    _role: { state: true },
  }

  declare _state: State
  declare _email: string | null
  /** What went wrong, for 'failed' */
  declare _message: string
  declare _joined: Space | null
  /** Their role in it, for 'joined' */
  declare _role: string

  /** Starts the app afresh at the home page, once this device has the space (a test gives its own) */
  /* v8 ignore next 3 -- reloading the page would end the test run: tests give their own */
  // biome-ignore lint/plugin: the database is another space's now, so start afresh
  reload: () => void = () => window.location.assign('/')
  /** The invite, once the link is read */
  _invite: { teamId: string; code: string } | null = null
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
  }

  override connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener(IncomingLinkEvent.type, this._onLink)
    window.addEventListener('hashchange', this._onHash)
    // (the installed app is given the link's fragment, launch.ts; a tab keeps it in the address)
    this._read(takeLink('/join') ?? this.fragment)
  }

  override disconnectedCallback(): void {
    window.removeEventListener(IncomingLinkEvent.type, this._onLink)
    window.removeEventListener('hashchange', this._onHash)
    super.disconnectedCallback()
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
    this._invite = parseInvite(fragment)
    this._message = ''
    if (this._invite) void this._check()
    else this._state = 'bad-link'
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
    this._state = 'ready'
  }

  /** Sign in with Google for who they are alone, then look again */
  async _signIn(): Promise<void> {
    try {
      await authorizeWithGoogle({ drive: false })
    } catch (error) {
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
      this._role = (joined.team as TeamLink).role
      this._state = 'joined'
    } catch (error) {
      this._message = this._explain(error)
      this._state = error instanceof SignInExpiredError ? 'sign-in' : 'failed'
    }
  }

  /** What to tell them of a refusal */
  _explain(error: unknown): string {
    if (error instanceof TeamError && error.status === 403) {
      return `This invite was sent to a different Google account${
        this._email ? `, not ${this._email}` : ''
      }. Sign in with the address it was sent to.`
    }
    if (error instanceof TeamError && error.status === 404) {
      return 'This invite is not valid. It may have been used, withdrawn or have run out: ask the person who sent it for a new one.'
    }
    return errorMessage(error)
  }

  /** The space is on this device: start the app afresh in it */
  _open(): void {
    if (this._joined) void switchSpace(this._joined.id, this.reload)
  }

  override render() {
    return html`<div class="page">${this._renderState()}</div>`
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
        return html`<p class="status" role="status">Checking…</p>`
      case 'sign-in':
        return html`
          <h2>Join a team space</h2>
          <p>
            You have been invited to a team space. Sign in with the Google account the invite was sent
            to. Chordless asks only who you are: it gets no access to your Google Drive.
          </p>
          ${this._message ? html`<p class="status error" role="alert">${this._message}</p>` : nothing}
          <div class="actions">
            <button class="btn primary" @click=${this._signIn}>🔑 Sign in with Google</button>
          </div>
        `
      case 'ready':
        return html`
          <h2>Join a team space</h2>
          <p>
            You are signed in${this._email ? html` as <span class="who">${this._email}</span>` : nothing}.
            Joining adds the team's songs and setlists to this device, and keeps them in step with the
            team's.
          </p>
          <div class="actions">
            <button class="btn primary" @click=${this._join}>Join the team space</button>
            <button class="btn" @click=${this._signIn}>Use a different account</button>
          </div>
        `
      case 'joining':
        return html`<p class="status" role="status">Joining…</p>`
      case 'joined':
        return html`
          <h2>You have joined ${this._joined?.name}</h2>
          <p>
            The space is on this device, and you are in it as a
            ${this._role}. Open it to sync the team's songs and setlists.
          </p>
          <div class="actions">
            <button class="btn primary" @click=${this._open}>Open ${this._joined?.name}</button>
          </div>
        `
      case 'failed':
        return html`
          <h2>Couldn't join</h2>
          <p class="status error" role="alert">${this._message}</p>
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
