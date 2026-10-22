/**
 * The account card at the top of Account and Teams: what it shows of the sign-in, signing in and
 * connecting Drive, logging out, and the tools under Manage. The service worker that keeps the
 * sign-in is a fake one (fake-auth-worker.ts).
 */
import { expect } from '@open-wc/testing'
import { type AccountCard, AccountStateEvent } from '../src/components/account-card.ts'
import type { AppModal } from '../src/components/app-modal.ts'
import '../src/components/account-card.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('account-card', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  let setController: (controller: unknown) => void
  let card: AccountCard
  let states: string[]
  const realFetch = window.fetch
  const realGoogle = (window as { google?: unknown }).google

  const text = () => (card.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
  const control = (id: string) => must(card.shadowRoot?.querySelector<HTMLButtonElement>(`#${id}`))

  async function until(condition: () => unknown, what: string) {
    for (let i = 0; i < 100 && !condition(); i++) await wait(20)
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

  async function open(signedIn = true, expiresInMs = 30 * 60 * 1000, scope?: string) {
    if (signedIn) {
      worker.stored = {
        blob: 'encrypted-blob',
        metadata: {
          access_token: 'token',
          expires_at: new Date(Date.now() + expiresInMs).toISOString(),
          ...(scope ? { scope } : {}),
          user,
        },
        updated_at: new Date().toISOString(),
      }
    }
    card = document.createElement('account-card')
    card.addEventListener(AccountStateEvent.type, event =>
      states.push((event as AccountStateEvent).state)
    )
    document.body.append(card)
    await until(() => card._state !== null, 'the sign-in to be looked at')
    await card.updateComplete
  }

  /** Answer the question the logout asks */
  async function answerLogout(confirm: boolean) {
    const modal = must(card.shadowRoot?.querySelector<AppModal>('app-modal[heading^="Log out"]'))
    await until(() => modal.open, 'the question to be asked')
    await modal.updateComplete
    must(
      modal.shadowRoot?.querySelector<HTMLElement>(
        confirm ? '.modal-btn-confirm' : '.modal-btn-cancel'
      )
    ).click()
  }

  beforeEach(() => {
    ;({ worker, uninstall: uninstallWorker, setController } = installFakeAuthWorker())
    states = []
  })

  afterEach(() => {
    card?.remove()
    window.fetch = realFetch
    ;(window as { google?: unknown }).google = realGoogle
    uninstallWorker()
  })

  describe('what it shows', () => {
    it('says who is signed in, and that Drive is connected, and tells the page', async () => {
      await open()
      expect(text()).to.contain('Ann Singer')
      expect(text()).to.contain('ann@example.com')
      expect(text()).to.contain('Google Drive connected')
      expect(card.shadowRoot?.querySelector('#sign-in')).to.equal(null)
      expect(states).to.deep.equal(['signed-in'])
    })

    it('shows their photo, or their initial when they have none', async () => {
      await open()
      card.remove()
      must(worker.stored).metadata.user = {
        ...user,
        picture: 'https://example.com/ann.png',
      } as never
      await open(false)
      expect(card.shadowRoot?.querySelector('img.avatar')?.getAttribute('src')).to.contain(
        'ann.png'
      )
      card.remove()
      must(worker.stored).metadata.user = { ...user, picture: null, name: null } as never
      await open(false)
      expect(card.shadowRoot?.querySelector('.avatar')?.textContent?.trim()).to.equal('A')
    })

    it('shows a sign-in with no profile in it as just signed in, with an initial of ?', async () => {
      await open()
      card.remove()
      must(worker.stored).metadata.user = undefined as never
      await open(false)
      expect(text()).to.contain('Signed in')
      expect(card.shadowRoot?.querySelector('.avatar')?.textContent?.trim()).to.equal('?')
      expect(card.shadowRoot?.querySelector('.email')).to.equal(null)
    })

    it('says no one is signed in, which is fine, and offers to sign in', async () => {
      await open(false)
      expect(text()).to.contain('Not signed in')
      expect(text()).to.contain('stay on this device')
      expect(control('sign-in').textContent).to.contain('Sign in with Google')
      expect(card.shadowRoot?.querySelector('#logout')).to.equal(null)
      expect(card.shadowRoot?.querySelector('#test-refresh')).to.equal(null)
      expect(states).to.deep.equal(['signed-out'])
    })

    it('says the sign-in has expired, with a way to reconnect, when Google no longer honours it', async () => {
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === '/session/refresh'
          ? Response.json({ error: 'invalid_grant' }, { status: 401 })
          : realFetch(input, init)) as typeof fetch
      await open(true, -60_000)
      expect(text()).to.contain('Sign-in expired')
      expect(text()).to.not.contain('Google Drive connected')
      expect(control('reconnect').textContent).to.contain('Reconnect with Google')
      expect(states).to.deep.equal(['expired'])
    })

    it('stays signed in when the refresh fails for another reason, such as no network', async () => {
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === '/session/refresh') throw new TypeError('Failed to fetch')
        return realFetch(input, init)
      }) as typeof fetch
      await open(true, -60_000)
      expect(text()).to.contain('Google Drive connected')
    })

    it('says Drive is not connected when the sign-in has none', async () => {
      await open(true, 30 * 60 * 1000, 'openid email profile')
      expect(text()).to.contain('Signed in, Google Drive not connected')
      expect(control('connect-drive').textContent).to.contain('Connect Google Drive')
      expect(states).to.deep.equal(['no-drive'])
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
      })

    beforeEach(() => {
      codeResponse = { code: 'the-code' }
      exchange = signedIn('https://www.googleapis.com/auth/drive.file openid email profile')
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === '/oauth/callback' ? exchange() : realFetch(input, init)) as typeof fetch
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

    it('signs in with Google, shows who has, and tells the page', async () => {
      await open(false)
      control('sign-in').click()
      await until(() => text().includes('Bea Singer'), 'the sign-in to finish')
      expect(text()).to.contain('Signed in.')
      expect(states).to.deep.equal(['signed-out', 'signed-in'])
    })

    it('signs in when the Drive box was left unticked, says so, and can connect Drive', async () => {
      await open(false)
      exchange = signedIn('openid email profile')
      control('sign-in').click()
      await until(() => text().includes('Drive was not connected'), 'the sign-in to finish')
      expect(text()).to.contain('Signed in, Google Drive not connected')

      exchange = signedIn('https://www.googleapis.com/auth/drive.file openid email profile')
      control('connect-drive').click()
      await until(() => text().includes('Google Drive connected.'), 'Drive to be connected')
      expect(card.shadowRoot?.querySelector('#connect-drive')).to.equal(null)
    })

    it('says so when Drive is still not connected after asking for it, and when asking fails', async () => {
      await open(false)
      exchange = signedIn('openid email profile')
      control('sign-in').click()
      await until(() => card._state === 'no-drive', 'the sign-in to finish')

      control('connect-drive').click()
      await until(() => text().includes('Google Drive was not connected.'), 'the answer')

      codeResponse = { error: 'access_denied' }
      control('connect-drive').click()
      await until(() => text().includes('Connecting Google Drive failed'), 'the failure')
      expect(text()).to.contain('access_denied')
    })

    it('reconnects after the sign-in expired', async () => {
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === '/session/refresh') {
          return Response.json({ error: 'invalid_grant' }, { status: 401 })
        }
        return String(input) === '/oauth/callback' ? exchange() : realFetch(input, init)
      }) as typeof fetch
      await open(true, -60_000)
      control('reconnect').click()
      await until(() => text().includes('Signed in.'), 'the sign-in to finish')
      expect(card._state).to.equal('signed-in')
    })

    it('says so when Google refuses', async () => {
      await open(false)
      codeResponse = { error: 'access_denied' }
      control('sign-in').click()
      await until(() => text().includes('Signing in failed'), 'the failure to be shown')
      expect(text()).to.contain('access_denied')
      expect(card._state).to.equal('signed-out')
    })
  })

  describe('logging out', () => {
    let revokeStatus: number
    let revoked: string[]
    beforeEach(() => {
      revokeStatus = 200
      revoked = []
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== '/session/logout') return realFetch(input, init)
        revoked.push(JSON.parse(String(init?.body)).blob)
        return new Response('{}', { status: revokeStatus })
      }) as typeof fetch
    })

    it('asks first, then deletes the sign-in, revokes the access at Google, and says so', async () => {
      await open()
      control('logout').click()
      await answerLogout(true)
      await until(() => text().includes('Not signed in'), 'the card to show it is signed out')
      expect(worker.messages.map(m => m.type)).to.include('DELETE_BLOB')
      expect(worker.stored).to.equal(undefined)
      expect(text()).to.contain('access to your Drive was revoked')
      expect(revoked).to.deep.equal(['encrypted-blob'])
    })

    it('says the access was not revoked when Google could not be reached, but is logged out', async () => {
      await open()
      revokeStatus = 502
      control('logout').click()
      await answerLogout(true)
      await until(() => text().includes('Not signed in'), 'the card to show it is signed out')
      expect(text()).to.contain('could not be reached to revoke')
      expect(text()).to.contain('myaccount.google.com/permissions')
    })

    it('does nothing when it is not confirmed', async () => {
      await open()
      control('logout').click()
      await answerLogout(false)
      await wait(100)
      expect(worker.stored).to.not.equal(undefined)
      expect(text()).to.contain('Google Drive connected')
      expect(revoked).to.deep.equal([])
    })

    it('says so, and stays signed in, when the service worker cannot do it', async () => {
      await open()
      worker.failing.add('DELETE_BLOB')
      control('logout').click()
      await answerLogout(true)
      await until(() => text().includes('Logging out failed'), 'the failure to be shown')
      expect(card._state).to.equal('signed-in')
    })
  })

  describe('the sign-in backup', () => {
    it('is downloaded, or its failure said', async () => {
      await open()
      const realClick = HTMLAnchorElement.prototype.click
      let downloads = 0
      HTMLAnchorElement.prototype.click = () => {
        downloads++
      }
      try {
        control('download-backup').click()
        await until(() => downloads === 1, 'the download')
        worker.failing.add('EXPORT_BLOB')
        control('download-backup').click()
        await until(() => text().includes('Downloading the backup failed'), 'the failure')
      } finally {
        HTMLAnchorElement.prototype.click = realClick
      }
    })

    describe('imported', () => {
      let chosen: HTMLInputElement | null
      const realClick = HTMLInputElement.prototype.click
      beforeEach(() => {
        chosen = null
        HTMLInputElement.prototype.click = function () {
          if (this.type === 'file') chosen = this
        }
      })
      afterEach(() => {
        HTMLInputElement.prototype.click = realClick
      })

      const choose = (file: File | null) =>
        must(chosen).onchange?.({ target: { files: file ? [file] : [] } } as unknown as Event)

      it('from a file, and signs the user in', async () => {
        await open(false)
        control('import-backup').click()
        expect(chosen?.accept).to.contain('json')
        await choose(
          new File(
            [
              JSON.stringify({
                version: 1,
                blob: 'restored',
                metadata: { user: { name: 'Cy', email: 'cy@example.com' } },
              }),
            ],
            'backup.json'
          )
        )
        await until(() => text().includes('backup imported'), 'the import to finish')
        expect(card._state).to.equal('signed-in')
        expect(worker.stored?.blob).to.equal('restored')
      })

      it('does nothing when no file was chosen', async () => {
        await open(false)
        control('import-backup').click()
        await choose(null)
        expect(card._state).to.equal('signed-out')
      })

      it('says so when the file is not a backup', async () => {
        await open(false)
        control('import-backup').click()
        await choose(new File(['not json'], 'backup.json'))
        await until(() => text().includes('Importing the backup failed'), 'the failure')
      })
    })
  })

  describe('testing a token refresh', () => {
    const refreshWith = (answer: () => Response) => {
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === '/session/refresh' ? answer() : realFetch(input, init)) as typeof fetch
    }

    it('refreshes an expired token, and says so', async () => {
      await open()
      refreshWith(() => Response.json({ access_token: 'fresh', expires_in: 3600 }))
      control('test-refresh').click()
      await until(() => text().includes('Token refresh works'), 'the test to pass')
    })

    it('says so when the refresh fails', async () => {
      await open()
      refreshWith(() => Response.json({ error: 'revoked' }, { status: 400 }))
      control('test-refresh').click()
      await until(() => text().includes('Token refresh failed'), 'the failure to be shown')
      expect(text()).to.contain('revoked')
    })

    it('says so when the new token is no better', async () => {
      await open()
      refreshWith(() => Response.json({ access_token: 'stale', expires_in: -3600 }))
      control('test-refresh').click()
      await until(() => text().includes('Token refresh failed'), 'the failure to be shown')
      expect(text()).to.contain('still expired')
    })

    it('notices the sign-in has expired', async () => {
      await open()
      refreshWith(() => Response.json({ error: 'invalid_grant' }, { status: 401 }))
      control('test-refresh').click()
      await until(() => card._state === 'expired', 'the card to notice')
      expect(text()).to.contain('Token refresh failed')
    })

    it('says when the service worker is not in control', async () => {
      await open()
      setController(null)
      control('test-refresh').click()
      await until(() => text().includes('service worker is not active'), 'the message')
    })

    it('says when nothing is signed in any more', async () => {
      await open()
      worker.stored = undefined
      control('test-refresh').click()
      await until(() => text().includes('Not signed in: sign in with Google first'), 'the message')
    })
  })
})
