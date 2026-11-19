/**
 * The account card at the top of Account and Teams: the name and addresses, whether the Personal space syncs (with Enable and
 * Disable), signing in, and logging out. The service worker that keeps the sign-in is a fake one (fake-auth-worker.ts), and the
 * Worker's account is a fetch that answers from what the test gives it.
 */
import { expect, waitUntil } from '@open-wc/testing'
import { type AccountCard, AccountStateEvent } from '../src/components/account-card.ts'
import type { AppModal } from '../src/components/app-modal.ts'
import '../src/components/account-card.ts'
import { type AccountInfo, setAccountStorageKey } from '../src/js/account-info.ts'
import { type FakeAuthWorker, installFakeAuthWorker, sessionFor } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { nothingFor, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

/** This file's own place for the account: test files share storage and run at once */
const KEY = 'chordless:account:test-card'

const DRIVE = 'https://www.googleapis.com/auth/drive.file openid email profile'

describe('account-card', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  let card: AccountCard
  let states: string[]
  /** What the Worker says of the account (null: it cannot be reached), and what was sent to it */
  let account: AccountInfo | null
  let puts: unknown[]
  /** Whether the account has Drive connected at the Worker (which holds the Google credential for every device) */
  let drive: boolean
  let routes: Record<string, (input: string, init?: RequestInit) => Response | undefined>
  const realFetch = window.fetch
  const realGoogle = (window as { google?: unknown }).google

  const text = () => (card.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
  /** The sign-in form of a card that is signed out, and Continue with Google on it */
  const signInForm = () => must(card.shadowRoot?.querySelector('sign-in-form'))
  const googleButton = () =>
    must(signInForm().shadowRoot?.querySelector<HTMLButtonElement>('button.google'))
  const control = (id: string) => must(card.shadowRoot?.querySelector<HTMLButtonElement>(`#${id}`))

  async function until(condition: () => unknown, what: string) {
    await waitUntil(() => condition(), what, { timeout: 2000 })
    expect(condition(), what).to.be.ok
  }

  const user = {
    name: 'Ann Singer',
    email: 'ann@example.com',
    picture: null,
    given_name: null,
    family_name: null,
    sub: '1',
  }

  /** Signed in with Google (with Drive, unless a scope without it is given), with a session as well */
  function signInWithGoogle(expiresInMs = 30 * 60 * 1000, scope = DRIVE) {
    drive = scope.includes('drive.file')
    worker.stored = {
      blob: '',
      metadata: {
        drive,
        access_token: 'token',
        expires_at: new Date(Date.now() + expiresInMs).toISOString(),
        scope,
        session: sessionFor('access-1'),
        user,
      },
      updated_at: new Date().toISOString(),
    }
  }

  /** Signed in by an emailed code alone: a session, and no Google */
  function signInByEmail() {
    worker.stored = {
      blob: '',
      metadata: {
        scope: '',
        session: sessionFor('access-1'),
        user: { ...user, name: null, sub: null },
      },
      updated_at: new Date().toISOString(),
    }
  }

  async function open() {
    card = document.createElement('account-card')
    card.addEventListener(AccountStateEvent.type, event =>
      states.push((event as AccountStateEvent).state)
    )
    document.body.append(card)
    await until(() => card._state !== null, 'the sign-in to be looked at')
    await card.updateComplete
  }

  /** Answer the question a modal of the card asks */
  async function answer(confirm: boolean, heading: string) {
    const modal = must(card.shadowRoot?.querySelector<AppModal>(`app-modal[heading^="${heading}"]`))
    await until(() => modal.open, 'the question to be asked')
    await modal.updateComplete
    must(
      modal.shadowRoot?.querySelector<HTMLElement>(
        confirm ? '.modal-btn-confirm' : '.modal-btn-cancel'
      )
    ).click()
  }

  beforeEach(() => {
    setAccountStorageKey(KEY)
    ;({ worker, uninstall: uninstallWorker } = installFakeAuthWorker())
    states = []
    account = {
      name: 'Ann Singer',
      emails: [{ email: 'ann@example.com', provider: 'google' }],
      googleEmail: 'ann@example.com',
    }
    puts = []
    drive = false
    routes = {
      '/api/account/drive/token': () =>
        drive
          ? Response.json({ access_token: 'drive-token', expires_in: 3600 })
          : Response.json({ error: 'not_connected' }, { status: 404 }),
      '/api/account/drive': (_url, init) => {
        if (init?.method !== 'DELETE') return undefined
        drive = false
        return Response.json({ success: true, revoked: true })
      },
    }
    localStorage.removeItem(KEY)
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const route = routes[url]?.(url, init)
      if (route) return route
      if (url === '/api/account') {
        if (!account) return Response.json({ error: 'down' }, { status: 503 })
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body))
          puts.push(body)
          if (body.name === 'refuse')
            return Response.json({ error: 'A name is needed' }, { status: 400 })
          account = { ...account, name: body.name }
        }
        return Response.json({ ...account, drive: drive ? { email: 'ann@example.com' } : null })
      }
      return realFetch(input, init)
    }) as typeof fetch
  })

  afterEach(() => {
    card?.remove()
    window.fetch = realFetch
    ;(window as { google?: unknown }).google = realGoogle
    localStorage.removeItem(KEY)
    uninstallWorker()
  })

  describe('what it shows', () => {
    it('says the name and the addresses, and tells the page how they are signed in', async () => {
      signInWithGoogle()
      await open()
      await until(() => text().includes('Ann Singer'), 'the name')
      expect(text()).to.contain('Name')
      expect(text()).to.contain('Emails')
      expect(text()).to.contain('ann@example.com')
      expect(text()).to.not.contain('synced via')
      expect(card.shadowRoot?.querySelector('sign-in-form')).to.equal(null)
      expect(control('logout')).to.exist
      expect(states).to.deep.equal(['signed-in'])
    })

    it('lists every address the account has, none marked as a separate login', async () => {
      account = {
        name: 'Ann Singer',
        emails: [
          { email: 'ann@hotmail.example', provider: 'email' },
          { email: 'ann@example.com', provider: 'google' },
        ],
        googleEmail: 'ann@example.com',
      }
      signInWithGoogle()
      await open()
      await until(() => text().includes('ann@hotmail.example'), 'the addresses')
      const items = Array.from(card.shadowRoot?.querySelectorAll('ul.emails li') ?? []).map(each =>
        (each.textContent ?? '').replace(/\s+/g, ' ').trim()
      )
      expect(items).to.deep.equal(['ann@hotmail.example', 'ann@example.com'])
    })

    it('shows what it kept when the Worker cannot be reached, and the address of the sign-in when it kept nothing', async () => {
      signInWithGoogle()
      await open()
      await until(() => text().includes('Ann Singer'), 'the name')
      card.remove()
      account = null
      await open()
      expect(text()).to.contain('Ann Singer')
      card.remove()
      localStorage.removeItem(KEY)
      await open()
      expect(text()).to.contain('ann@example.com')
      expect(text()).to.contain('Not set')
    })

    it('says there are no addresses yet, when the sign-in says none and the Worker cannot be reached', async () => {
      account = null
      signInByEmail()
      must(worker.stored).metadata.user = undefined
      await open()
      expect(text()).to.contain('None yet')
    })

    it('shows the address an emailed sign-in used, until the Worker says the rest', async () => {
      account = null
      signInByEmail()
      await open()
      expect(text()).to.contain('ann@example.com')
      expect(card.shadowRoot?.querySelector('.chip')).to.equal(null)
    })

    it('says no one is signed in, which is fine, and offers to sign in', async () => {
      await open()
      expect(text()).to.contain('Not signed in')
      expect(text()).to.contain('stay on this device')
      expect(googleButton().textContent).to.contain('Continue with Google')
      expect(card.shadowRoot?.querySelector('#logout')).to.equal(null)
      expect(card.shadowRoot?.querySelector('dl')).to.equal(null)
      expect(states).to.deep.equal(['signed-out'])
    })

    it('tells the page the Google Drive connection has expired, and shows the account all the same', async () => {
      routes['/api/account/drive/token'] = () =>
        Response.json({ error: 'invalid_grant' }, { status: 401 })
      signInWithGoogle(-60_000)
      await open()
      expect(text()).to.contain('Ann Singer')
      expect(states).to.deep.equal(['expired'])
    })

    it('stays signed in when the Drive token cannot be had for another reason, such as no network', async () => {
      routes['/api/account/drive/token'] = () => {
        throw new TypeError('Failed to fetch')
      }
      signInWithGoogle(-60_000)
      await open()
      expect(states).to.deep.equal(['signed-in'])
    })

    it('tells the page the account has no Drive, however they signed in', async () => {
      signInWithGoogle(30 * 60 * 1000, 'openid email profile')
      await open()
      expect(states).to.deep.equal(['no-drive'])
    })
  })

  describe('the name', () => {
    it('is added when there is none, and kept at the Worker', async () => {
      account = {
        name: null,
        emails: [{ email: 'ann@example.com', provider: 'email' }],
        googleEmail: null,
      }
      signInByEmail()
      await open()
      await until(() => text().includes('Not set'), 'the missing name')
      control('edit-name').click()
      await until(() => card.shadowRoot?.querySelector('form.name'), 'the form')
      const input = must(card.shadowRoot?.querySelector<HTMLInputElement>('form.name input'))
      input.value = 'Ann Lee'
      must(card.shadowRoot?.querySelector<HTMLFormElement>('form.name')).requestSubmit()
      await until(() => !card.shadowRoot?.querySelector('form.name'), 'the form to close')
      expect(puts).to.deep.equal([{ name: 'Ann Lee' }])
      expect(text()).to.contain('Ann Lee')
    })

    it('is changed, and the change can be abandoned', async () => {
      signInWithGoogle()
      await open()
      await until(() => text().includes('Ann Singer'), 'the name')
      control('edit-name').click()
      await until(() => card.shadowRoot?.querySelector('form.name'), 'the form')
      expect(
        must(card.shadowRoot?.querySelector<HTMLInputElement>('form.name input')).value
      ).to.equal('Ann Singer')
      const cancel = must(
        Array.from(card.shadowRoot?.querySelectorAll('form.name button') ?? []).find(each =>
          each.textContent?.includes('Cancel')
        )
      ) as HTMLButtonElement
      cancel.click()
      await until(() => !card.shadowRoot?.querySelector('form.name'), 'the form to close')
      expect(puts).to.deep.equal([])
    })

    it('says what the Worker said when it refuses, and leaves the form for another try', async () => {
      signInWithGoogle()
      await open()
      await until(() => text().includes('Ann Singer'), 'the name')
      control('edit-name').click()
      await until(() => card.shadowRoot?.querySelector('form.name'), 'the form')
      must(card.shadowRoot?.querySelector<HTMLInputElement>('form.name input')).value = 'refuse'
      must(card.shadowRoot?.querySelector<HTMLFormElement>('form.name')).requestSubmit()
      await until(() => text().includes('A name is needed'), 'the refusal')
      expect(card.shadowRoot?.querySelector('form.name')).to.exist
    })
  })

  describe('signing in', () => {
    let codeResponse: { code?: string; error?: string }
    let exchange: () => Response

    const signedIn = (scope: string) => () => {
      // (the Worker keeps the credential for the account when Drive was granted)
      drive = scope.includes('drive.file')
      return Response.json({
        blob: 'new-blob',
        access_token: 'tok',
        expires_in: 3600,
        scope,
        user: { name: 'Bea Singer', email: 'bea@example.com', picture: null },
        session: { access_token: 'access-2', refresh_token: 'id.secret', expires_in: 900 },
      })
    }

    beforeEach(() => {
      codeResponse = { code: 'the-code' }
      exchange = signedIn(DRIVE)
      routes['/oauth/callback'] = () => exchange()
      ;(window as { google?: unknown }).google = {
        accounts: {
          oauth2: {
            initCodeClient: (config: { callback: (response: object) => void }) => ({
              requestCode: () => config.callback(codeResponse),
            }),
          },
        },
      }
    })

    it('signs in with Google, shows the account, and tells the page', async () => {
      account = {
        name: 'Bea Singer',
        emails: [{ email: 'bea@example.com', provider: 'google' }],
        googleEmail: 'bea@example.com',
      }
      await open()
      googleButton().click()
      await until(() => text().includes('Bea Singer'), 'the sign-in to finish')
      expect(text()).to.contain('Signed in.')
      expect(states).to.deep.equal(['signed-out', 'signed-in'])
    })

    it('signs in when the Drive box was left unticked, and says so', async () => {
      await open()
      exchange = signedIn('openid email profile')
      googleButton().click()
      await until(() => text().includes('Drive was not connected'), 'the sign-in to finish')
      expect(card._state).to.equal('no-drive')
    })

    it('says so when Google refuses', async () => {
      await open()
      codeResponse = { error: 'access_denied' }
      googleButton().click()
      await until(
        () => (signInForm().shadowRoot?.textContent ?? '').includes('Signing in failed'),
        'the failure to be shown'
      )
      expect(signInForm().shadowRoot?.textContent).to.not.contain('access_denied')
      expect(card._state).to.equal('signed-out')
    })

    it('offers an emailed code on the same form as Google, and signs in when the code is right', async () => {
      await open()
      expect(signInForm().shadowRoot?.querySelector('email-code-sign-in')).to.exist
      expect(googleButton()).to.exist
      signInByEmail()
      signInForm().dispatchEvent(
        new Event('email-code:signed-in', { bubbles: true, composed: true })
      )
      await until(() => text().includes('Signed in.'), 'the message')
      expect(card.shadowRoot?.querySelector('sign-in-form')).to.equal(null)
      expect(states.at(-1)).to.equal('no-drive')
    })
  })

  describe('logging out', () => {
    let logged: unknown[]
    beforeEach(() => {
      logged = []
      routes['/session/logout'] = (_url, init) => {
        logged.push(JSON.parse(String(init?.body)))
        return new Response('{}')
      }
    })

    it('asks first, then deletes the sign-in on this device, ends its session, and forgets the account', async () => {
      signInWithGoogle()
      await open()
      await until(() => text().includes('Ann Singer'), 'the account to be read')
      control('logout').click()
      await answer(true, 'Log out')
      await until(() => text().includes('Not signed in'), 'the card to show it is signed out')
      expect(worker.messages.map(m => m.type)).to.include('DELETE_BLOB')
      expect(worker.stored).to.equal(undefined)
      expect(localStorage.getItem(KEY)).to.equal(null)
      expect(logged).to.deep.equal([{ refresh_token: 'session-id.refresh-secret' }])
    })

    it('does nothing when it is not confirmed', async () => {
      signInWithGoogle()
      await open()
      control('logout').click()
      await answer(false, 'Log out')
      await nothingFor()
      expect(worker.stored).to.not.equal(undefined)
      expect(text()).to.contain('Ann Singer')
      expect(logged).to.deep.equal([])
    })

    it('says so, and stays signed in, when the service worker cannot do it', async () => {
      signInWithGoogle()
      await open()
      worker.failing.add('DELETE_BLOB')
      control('logout').click()
      await answer(true, 'Log out')
      await until(() => text().includes('Logging out failed'), 'the failure to be shown')
      expect(card._state).to.equal('signed-in')
    })
  })
})
