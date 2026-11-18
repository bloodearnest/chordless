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
  let routes: Record<string, (input: string, init?: RequestInit) => Response | undefined>
  const realFetch = window.fetch
  const realGoogle = (window as { google?: unknown }).google

  const text = () => (card.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
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
    worker.stored = {
      blob: 'encrypted-blob',
      metadata: {
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
    routes = {}
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
        return Response.json(account)
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
    it('says the name, the addresses, and that the Personal space syncs, with the Google address, and tells the page', async () => {
      signInWithGoogle()
      await open()
      await until(() => text().includes('Ann Singer'), 'the name')
      expect(text()).to.contain('Name')
      expect(text()).to.contain('Emails')
      expect(text()).to.contain('ann@example.com')
      expect(text()).to.contain('On, with ann@example.com')
      expect(control('disable-sync').textContent).to.contain('Disable')
      expect(card.shadowRoot?.querySelector('#sign-in')).to.equal(null)
      expect(states).to.deep.equal(['signed-in'])
    })

    it('lists every address the account has, marking the Google one', async () => {
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
      expect(items).to.deep.equal(['ann@hotmail.example', 'ann@example.com Google'])
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

    it('says syncing is on even when the sign-in kept no profile to name the Google account', async () => {
      account = null
      signInWithGoogle()
      must(worker.stored).metadata.user = undefined
      await open()
      expect(text()).to.contain('On, with')
    })

    it('says no one is signed in, which is fine, and offers to sign in', async () => {
      await open()
      expect(text()).to.contain('Not signed in')
      expect(text()).to.contain('stay on this device')
      expect(control('sign-in').textContent).to.contain('Sign in with Google')
      expect(card.shadowRoot?.querySelector('#logout')).to.equal(null)
      expect(card.shadowRoot?.querySelector('dl')).to.equal(null)
      expect(states).to.deep.equal(['signed-out'])
    })

    it('says the sign-in has expired, with a way to reconnect, when Google no longer honours it', async () => {
      routes['/session/refresh'] = () => Response.json({ error: 'invalid_grant' }, { status: 401 })
      signInWithGoogle(-60_000)
      await open()
      expect(text()).to.contain('Sign-in expired')
      expect(text()).to.not.contain('On, with')
      expect(control('reconnect').textContent).to.contain('Reconnect with Google')
      expect(states).to.deep.equal(['expired'])
    })

    it('stays on when the refresh fails for another reason, such as no network', async () => {
      routes['/session/refresh'] = () => {
        throw new TypeError('Failed to fetch')
      }
      signInWithGoogle(-60_000)
      await open()
      expect(text()).to.contain('On, with ann@example.com')
    })

    it('says syncing is off, with Enable, for a Google sign-in without Drive', async () => {
      signInWithGoogle(30 * 60 * 1000, 'openid email profile')
      await open()
      expect(text()).to.contain('Google Drive is not connected')
      expect(control('enable-sync').textContent).to.contain('Enable')
      expect(card.shadowRoot?.querySelector('#disable-sync')).to.equal(null)
      expect(states).to.deep.equal(['no-drive'])
    })

    it('says syncing is off, with Enable, for an emailed sign-in, which needs a Google account', async () => {
      signInByEmail()
      await open()
      expect(text()).to.contain('needs a Google account')
      expect(control('enable-sync').textContent).to.contain('Enable')
      expect(card.shadowRoot?.querySelector('#revoke')).to.equal(null)
      expect(card.shadowRoot?.querySelector('#test-refresh')).to.equal(null)
      expect(card.shadowRoot?.querySelector('details')).to.equal(null)
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

    const signedIn = (scope: string) => () =>
      Response.json({
        blob: 'new-blob',
        access_token: 'tok',
        expires_in: 3600,
        scope,
        user: { name: 'Bea Singer', email: 'bea@example.com', picture: null },
        session: { access_token: 'access-2', refresh_token: 'id.secret', expires_in: 900 },
      })

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
      control('sign-in').click()
      await until(() => text().includes('Bea Singer'), 'the sign-in to finish')
      expect(text()).to.contain('Signed in.')
      expect(states).to.deep.equal(['signed-out', 'signed-in'])
    })

    it('signs in when the Drive box was left unticked, says so, and can enable Drive', async () => {
      await open()
      exchange = signedIn('openid email profile')
      control('sign-in').click()
      await until(() => text().includes('Drive was not connected'), 'the sign-in to finish')
      expect(text()).to.contain('Google Drive is not connected')

      exchange = signedIn(DRIVE)
      control('enable-sync').click()
      await until(() => text().includes('Google Drive connected.'), 'Drive to be connected')
      expect(card.shadowRoot?.querySelector('#enable-sync')).to.equal(null)
    })

    it('says so when Drive is still not connected after asking for it, and when asking fails', async () => {
      await open()
      exchange = signedIn('openid email profile')
      control('sign-in').click()
      await until(() => card._state === 'no-drive', 'the sign-in to finish')

      control('enable-sync').click()
      await until(() => text().includes('Google Drive was not connected.'), 'the answer')

      codeResponse = { error: 'access_denied' }
      control('enable-sync').click()
      await until(() => text().includes('Connecting Google Drive failed'), 'the failure')
      // (what Google answered is for a developer: the page says what could not be done)
      expect(text()).to.not.contain('access_denied')
    })

    it('reconnects after the sign-in expired', async () => {
      routes['/session/refresh'] = () => Response.json({ error: 'invalid_grant' }, { status: 401 })
      signInWithGoogle(-60_000)
      await open()
      control('reconnect').click()
      await until(() => text().includes('Signed in.'), 'the sign-in to finish')
      expect(card._state).to.equal('signed-in')
    })

    it('says so when Google refuses', async () => {
      await open()
      codeResponse = { error: 'access_denied' }
      control('sign-in').click()
      await until(() => text().includes('Signing in failed'), 'the failure to be shown')
      expect(text()).to.not.contain('access_denied')
      expect(card._state).to.equal('signed-out')
    })

    it('offers an emailed code beside Google, and signs in when the code is right', async () => {
      await open()
      expect(card.shadowRoot?.querySelector('email-code-sign-in')).to.equal(null)
      control('sign-in-email').click()
      await until(() => card.shadowRoot?.querySelector('email-code-sign-in'), 'the form')
      signInByEmail()
      card.shadowRoot
        ?.querySelector('email-code-sign-in')
        ?.dispatchEvent(new Event('email-code:signed-in', { bubbles: true, composed: true }))
      await until(() => text().includes('Signed in with your email address.'), 'the message')
      expect(card.shadowRoot?.querySelector('email-code-sign-in')).to.equal(null)
      expect(states.at(-1)).to.equal('no-drive')
    })
  })

  describe('enabling the sync for an emailed sign-in', () => {
    let sent: { authorization: string | null }[]
    let callback: () => Response
    beforeEach(() => {
      sent = []
      callback = () =>
        Response.json({
          blob: 'new-blob',
          access_token: 'tok',
          expires_in: 3600,
          scope: DRIVE,
          user: { name: 'Bea Singer', email: 'bea@gmail.example', picture: null },
          session: { access_token: 'access-2', refresh_token: 'id.secret', expires_in: 900 },
        })
      routes['/oauth/callback'] = (_url, init) => {
        sent.push({ authorization: new Headers(init?.headers).get('Authorization') })
        return callback()
      }
      ;(window as { google?: unknown }).google = {
        accounts: {
          oauth2: {
            initCodeClient: (config: { callback: (response: object) => void }) => ({
              requestCode: () => config.callback({ code: 'the-code' }),
            }),
          },
        },
      }
    })

    it('adds Google to the account they are signed in to, by showing the session', async () => {
      signInByEmail()
      await open()
      control('enable-sync').click()
      await until(() => text().includes('On, with bea@gmail.example'), 'Google to be connected')
      expect(sent).to.deep.equal([{ authorization: 'Bearer access-1' }])
      expect(must(worker.stored).blob).to.equal('new-blob')
    })

    it('says when that Google account is already another Chordless account', async () => {
      signInByEmail()
      callback = () => Response.json({ error: 'google_in_use' }, { status: 409 })
      await open()
      control('enable-sync').click()
      await until(() => text().includes('already used by another Chordless account'), 'the message')
      expect(must(worker.stored).blob).to.equal('')
    })
  })

  describe('disabling the sync', () => {
    it('asks first, then forgets Google on this device, keeping them signed in and revoking nothing', async () => {
      const fetched: string[] = []
      routes['/session/logout'] = url => {
        fetched.push(url)
        return new Response('{}')
      }
      signInWithGoogle()
      await open()
      control('disable-sync').click()
      await answer(true, 'Turn off syncing')
      await until(() => text().includes('Syncing is off on this device'), 'the message')
      expect(must(worker.stored).blob).to.equal('')
      expect(must(worker.stored).metadata.session?.refresh_token).to.equal(
        'session-id.refresh-secret'
      )
      expect(card._state).to.equal('no-drive')
      expect(control('enable-sync')).to.exist
      expect(fetched, 'Google is not revoked: other devices keep their sync').to.deep.equal([])
    })

    it('does nothing when it is not confirmed', async () => {
      signInWithGoogle()
      await open()
      control('disable-sync').click()
      await answer(false, 'Turn off syncing')
      await nothingFor()
      expect(must(worker.stored).blob).to.equal('encrypted-blob')
      expect(text()).to.contain('On, with')
    })

    it('says so, and stays on, when the service worker cannot keep the change', async () => {
      signInWithGoogle()
      await open()
      worker.failing.add('STORE_BLOB')
      control('disable-sync').click()
      await answer(true, 'Turn off syncing')
      await until(() => text().includes('Turning syncing off failed'), 'the failure')
      expect(card._state).to.equal('signed-in')
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
      expect(text()).to.contain('On, with')
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
