/**
 * The storage page's Google Drive section: what it shows of the sign-in, and logging out. The
 * service worker that keeps the sign-in is a fake one (see fake-auth-worker.ts), and Drive a fake
 * Drive, which the rest of the page asks about itself.
 */

import { expect } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import '../src/components/storage-page.ts'
import type { StoragePage } from '../src/components/storage-page.ts'
import { createSpace, deleteSpace, getCurrentSpace, setCurrentSpace } from '../src/js/space.ts'
import { SpaceDB } from '../src/js/space-db.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('the storage page, signed in to Google', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  let setController: (controller: unknown) => void
  let drive: ReturnType<typeof installFakeDrive>
  let page: StoragePage
  let realError: typeof console.error

  const text = () => page.shadowRoot?.textContent ?? ''
  const button = (label: string) =>
    must(
      Array.from(page.shadowRoot?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(b =>
        b.textContent?.includes(label)
      )
    )

  async function until(condition: () => unknown, what: string) {
    for (let i = 0; i < 100 && !condition(); i++) await wait(20)
    expect(condition(), what).to.be.ok
  }

  /** Answer the question the logout asks */
  async function answerLogout(confirm: boolean) {
    const modal = must(page.shadowRoot?.querySelector<AppModal>('app-modal[heading^="Log out"]'))
    await until(() => modal.open, 'the question to be asked')
    await modal.updateComplete
    must(
      modal.shadowRoot?.querySelector<HTMLElement>(
        confirm ? '.modal-btn-confirm' : '.modal-btn-cancel'
      )
    ).click()
  }

  async function open(signedIn = true, expiresInMs = 30 * 60 * 1000) {
    if (signedIn) {
      worker.stored = {
        blob: 'encrypted-blob',
        metadata: {
          access_token: 'token',
          expires_at: new Date(Date.now() + expiresInMs).toISOString(),
          user: {
            name: 'Ann Singer',
            email: 'ann@example.com',
            picture: null,
            given_name: null,
            family_name: null,
            sub: '1',
          },
        },
        updated_at: new Date().toISOString(),
      }
    }
    page = document.createElement('storage-page')
    document.body.append(page)
    await until(() => page.authStatus === 'ready', 'the sign-in to be checked')
    await page.updateComplete
  }

  beforeEach(() => {
    ;({ worker, uninstall: uninstallWorker, setController } = installFakeAuthWorker())
    drive = installFakeDrive()
    realError = console.error
    console.error = () => {}
  })

  afterEach(() => {
    page?.remove()
    console.error = realError
    drive.uninstall()
    uninstallWorker()
  })

  it('shows who is connected', async () => {
    await open()
    expect(text()).to.contain('Connected')
    expect(text()).to.contain('Ann Singer')
    expect(text()).to.contain('ann@example.com')
  })

  it('shows the photo of whoever is connected, or their initial when they have none', async () => {
    await open()
    must(worker.stored).metadata.user = {
      ...must(worker.stored).metadata.user,
      picture: 'https://example.com/ann.png',
    } as never
    page.remove()
    await open(false)
    expect(page.shadowRoot?.querySelector('img.user-avatar')?.getAttribute('src')).to.contain(
      'ann.png'
    )
    page.remove()
    must(worker.stored).metadata.user = {
      ...must(worker.stored).metadata.user,
      name: null,
      avatarDataUrl: 'data:image/png;base64,AA',
    } as never
    await open(false)
    expect(page.shadowRoot?.querySelector('img.user-avatar')?.getAttribute('alt')).to.equal(
      'Google account photo'
    )
    page.remove()
    must(worker.stored).metadata.user = {
      ...must(worker.stored).metadata.user,
      picture: null,
      avatarDataUrl: undefined,
      name: null,
    } as never
    await open(false)
    expect(page.shadowRoot?.querySelector('.user-avatar')?.textContent?.trim()).to.equal('A')
    page.remove()
    must(worker.stored).metadata.user = {
      ...must(worker.stored).metadata.user,
      email: null,
    } as never
    await open(false)
    expect(page.shadowRoot?.querySelector('.user-avatar')?.textContent?.trim()).to.equal('?')
    expect(text()).to.contain('Signed in user')
    expect(page.shadowRoot?.querySelector('.user-email')).to.equal(null)
  })

  it('offers to connect when nobody is signed in', async () => {
    await open(false)
    expect(text()).to.contain('Not Connected')
    expect(text()).not.to.contain('Logout')
  })

  describe('logging out', () => {
    /** Google (through the auth proxy) answers the revoke: ok, or not */
    let revokeStatus: number
    let revoked: string[]
    let driveFetch: typeof fetch
    beforeEach(() => {
      revokeStatus = 200
      revoked = []
      driveFetch = window.fetch
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== '/session/logout') return driveFetch(input, init)
        revoked.push(JSON.parse(String(init?.body)).blob)
        return new Response('{}', { status: revokeStatus })
      }) as typeof fetch
    })
    afterEach(() => {
      window.fetch = driveFetch
    })

    it('asks first, then deletes the sign-in, revokes the access at Google, and says so', async () => {
      await open()

      button('Logout').click()
      await answerLogout(true)
      await until(() => text().includes('Not Connected'), 'the page to show it is signed out')

      expect(worker.messages.map(m => m.type)).to.include('DELETE_BLOB')
      expect(worker.stored).to.equal(undefined)
      expect(page.isAuthenticated).to.equal(false)
      expect(text()).to.contain('Successfully logged out')
      expect(text()).to.contain('access to your Drive was revoked')
      expect(revoked).to.deep.equal(['encrypted-blob'])
    })

    it('says the access was not revoked when Google could not be reached, but is logged out', async () => {
      await open()
      revokeStatus = 502

      button('Logout').click()
      await answerLogout(true)
      await until(() => text().includes('Not Connected'), 'the page to show it is signed out')

      expect(text()).to.contain('could not be reached to revoke')
      expect(text()).to.contain('myaccount.google.com/permissions')
      expect(worker.stored).to.equal(undefined)
    })

    it('does nothing when it is not confirmed', async () => {
      await open()

      button('Logout').click()
      await answerLogout(false)
      await wait(100)

      expect(worker.messages.map(m => m.type)).not.to.include('DELETE_BLOB')
      expect(worker.stored).to.not.equal(undefined)
      expect(text()).to.contain('Connected')
      expect(text()).not.to.contain('Successfully logged out')
      expect(revoked).to.deep.equal([])
    })

    it('says so, and stays connected, when the service worker cannot do it', async () => {
      await open()
      worker.failing.add('DELETE_BLOB')

      button('Logout').click()
      await answerLogout(true)
      await until(() => text().includes('Logging out failed'), 'the failure to be shown')

      expect(page.isAuthenticated).to.equal(true)
      expect(worker.stored).to.not.equal(undefined)
    })
  })

  describe('connecting', () => {
    const realFetch = window.fetch
    const realGoogle = (window as { google?: unknown }).google
    let codeResponse: { code?: string; error?: string }
    let exchange: () => Response

    beforeEach(() => {
      codeResponse = { code: 'the-code' }
      exchange = () =>
        Response.json({
          blob: 'new-blob',
          access_token: 'tok',
          expires_in: 3600,
          user: { name: 'Bea Singer', email: 'bea@example.com', picture: null },
        })
      const drivesFetch = window.fetch
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === '/oauth/callback' ? exchange() : drivesFetch(input, init)) as typeof fetch
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

    afterEach(() => {
      window.fetch = realFetch
      ;(window as { google?: unknown }).google = realGoogle
    })

    it('signs in with Google, and shows who has', async () => {
      await open(false)
      button('Connect with Google').click()
      await until(() => text().includes('Authorization successful'), 'the sign-in to finish')
      expect(page.isAuthenticated).to.equal(true)
      expect(page.userInfo?.name).to.equal('Bea Singer')
      expect(page.authStatus).to.equal('ready')
    })

    it('says what to tick when the Drive box was left unticked, and can be tried again', async () => {
      await open(false)
      exchange = () =>
        Response.json(
          { error: 'Drive access not granted', granted_scopes: 'openid' },
          { status: 400 }
        )
      button('Connect with Google').click()
      await until(() => text().includes('Authorization failed'), 'the failure to be shown')
      expect(text()).to.contain('tick the Google Drive box')
      expect(page.isAuthenticated).to.equal(false)

      exchange = () =>
        Response.json({
          blob: 'new-blob',
          access_token: 'tok',
          expires_in: 3600,
          user: { name: 'Bea Singer', email: 'bea@example.com', picture: null },
        })
      button('Connect with Google').click()
      await until(() => text().includes('Authorization successful'), 'the sign-in to finish')
      expect(text()).to.not.contain('tick the Google Drive box')
    })

    it('says the sign-in has expired, with a way to reconnect, when Google no longer honours it', async () => {
      const refresh = Response.json({ error: 'invalid_grant' }, { status: 401 })
      const before = window.fetch
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === '/session/refresh'
          ? refresh.clone()
          : before(input, init)) as typeof fetch
      await open(true, -60_000)

      expect(page.isAuthenticated).to.equal(true)
      expect(page.signInExpired).to.equal(true)
      expect(text()).to.contain('Sign-in expired')
      expect(text()).to.not.contain('✓ Connected')
      expect(text()).to.contain('Reconnect with Google above to sync again')
      expect(
        must(page.shadowRoot?.querySelector('drive-sync-panel')).hasAttribute('disabled')
      ).to.equal(true)

      button('Reconnect with Google').click()
      await until(() => text().includes('Authorization successful'), 'the sign-in to finish')
      expect(page.signInExpired).to.equal(false)
      expect(text()).to.contain('Connected')
    })

    it('stays connected when the refresh fails for another reason, such as no network', async () => {
      const before = window.fetch
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === '/session/refresh') throw new TypeError('Failed to fetch')
        return before(input, init)
      }) as typeof fetch
      await open(true, -60_000)
      expect(page.signInExpired).to.equal(false)
      expect(text()).to.contain('Connected')
    })

    it('says so when the token refresh test finds the sign-in expired', async () => {
      await open()
      const before = window.fetch
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === '/session/refresh'
          ? Response.json({ error: 'invalid_grant' }, { status: 401 })
          : before(input, init)) as typeof fetch
      button('Test Token Refresh').click()
      await until(() => page.signInExpired, 'the page to notice')
      expect(text()).to.contain('Token refresh test failed')
    })

    it('says so when Google refuses', async () => {
      await open(false)
      codeResponse = { error: 'access_denied' }
      button('Connect with Google').click()
      await until(() => text().includes('Authorization failed'), 'the failure to be shown')
      expect(text()).to.contain('access_denied')
      expect(page.isAuthenticated).to.equal(false)
    })
  })

  describe('the auth backup', () => {
    it('is downloaded, or its failure said', async () => {
      await open()
      const realClick = HTMLAnchorElement.prototype.click
      let downloads = 0
      HTMLAnchorElement.prototype.click = () => {
        downloads++
      }
      try {
        button('Download Auth Backup').click()
        await until(() => downloads === 1, 'the download')
        worker.failing.add('EXPORT_BLOB')
        button('Download Auth Backup').click()
        await until(
          () => text().includes('Downloading the backup failed'),
          'the failure to be shown'
        )
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
        button('Import Auth Backup').click()
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
        await until(() => text().includes('imported successfully'), 'the import to finish')
        expect(page.isAuthenticated).to.equal(true)
        expect(worker.stored?.blob).to.equal('restored')
      })

      it('does nothing when no file was chosen', async () => {
        await open(false)
        button('Import Auth Backup').click()
        await choose(null)
        expect(page.isAuthenticated).to.equal(false)
      })

      it('says so when the file is not a backup', async () => {
        await open(false)
        button('Import Auth Backup').click()
        await choose(new File(['not json'], 'backup.json'))
        await until(() => text().includes('Importing the backup failed'), 'the failure to be shown')
      })
    })
  })

  describe('testing a token refresh', () => {
    const realFetch = window.fetch
    afterEach(() => {
      window.fetch = realFetch
    })

    it('refreshes an expired token, and says so', async () => {
      await open()
      const drivesFetch = window.fetch
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === '/session/refresh'
          ? Response.json({ access_token: 'fresh', expires_in: 3600 })
          : drivesFetch(input, init)) as typeof fetch
      button('Test Token Refresh').click()
      await until(() => text().includes('Token refresh test passed'), 'the test to pass')
    })

    it('says so when the refresh fails', async () => {
      await open()
      const drivesFetch = window.fetch
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === '/session/refresh'
          ? Response.json({ error: 'revoked' }, { status: 400 })
          : drivesFetch(input, init)) as typeof fetch
      button('Test Token Refresh').click()
      await until(() => text().includes('Token refresh test failed'), 'the failure to be shown')
      expect(text()).to.contain('revoked')
    })

    it('says when the service worker is not in control', async () => {
      await open()
      setController(null)
      button('Test Token Refresh').click()
      await until(() => text().includes('Service Worker not active'), 'the message')
    })

    it('says when nothing is connected any more', async () => {
      await open()
      worker.stored = undefined
      button('Test Token Refresh').click()
      await until(() => text().includes('Not connected'), 'the message')
    })

    it('says so when the new token is no better', async () => {
      await open()
      const drivesFetch = window.fetch
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === '/session/refresh'
          ? Response.json({ access_token: 'stale', expires_in: -3600 })
          : drivesFetch(input, init)) as typeof fetch
      button('Test Token Refresh').click()
      await until(() => text().includes('Token refresh test failed'), 'the failure to be shown')
      expect(text()).to.contain('still expired')
    })
  })

  describe('clearing local data', () => {
    let before: { id: string | null; name: string }
    let spaceId: string
    const realClear = Storage.prototype.clear
    let cleared: number
    let reloads: number

    beforeEach(async () => {
      before = getCurrentSpace()
      const space = await createSpace(`Clear ${crypto.randomUUID().slice(0, 8)}`)
      spaceId = space.id
      await setCurrentSpace(space.id, space.name)
      cleared = 0
      reloads = 0
      // (clearing the page's storage would take what the other tests have set with it)
      Storage.prototype.clear = () => {
        cleared++
      }
    })

    afterEach(async () => {
      Storage.prototype.clear = realClear
      await deleteSpace(spaceId)
      if (before.id) await setCurrentSpace(before.id, before.name)
    })

    it('asks first, then clears the database and storage and starts afresh', async () => {
      await open()
      page.reload = () => {
        reloads++
      }
      must(page._clearDataModal.value).ask = async () => true
      button('Clear Local Data').click()
      await until(() => reloads === 1, 'the app to start afresh')
      expect(cleared).to.equal(2)
    })

    it('does nothing when it is not confirmed', async () => {
      await open()
      page.reload = () => {
        reloads++
      }
      must(page._clearDataModal.value).ask = async () => false
      button('Clear Local Data').click()
      await wait(100)
      expect(reloads).to.equal(0)
      expect(cleared).to.equal(0)
    })

    it('says so when it cannot', async () => {
      await open()
      page.reload = () => {
        reloads++
      }
      must(page._clearDataModal.value).ask = async () => true
      Storage.prototype.clear = () => {
        throw new Error('blocked')
      }
      button('Clear Local Data').click()
      await until(() => text().includes('Failed to clear data'), 'the failure to be shown')
      expect(text()).to.contain('blocked')
      expect(reloads).to.equal(0)
    })
  })

  describe('deleting a space', () => {
    let before: { id: string | null; name: string }
    let current: { id: string; name: string }
    const made: string[] = []
    const picker = () =>
      must(page.shadowRoot?.querySelector<HTMLSelectElement>('select#space-to-delete'))
    const choose = async (id: string) => {
      picker().value = id
      picker().dispatchEvent(new Event('change'))
      await page.updateComplete
    }
    const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`

    beforeEach(async () => {
      before = getCurrentSpace()
      current = await createSpace(unique('Working'))
      await setCurrentSpace(current.id, current.name)
    })

    afterEach(async () => {
      for (const id of [current.id, ...made.splice(0)]) await deleteSpace(id).catch(() => {})
      if (before.id) await setCurrentSpace(before.id, before.name)
    })

    async function makeOther(name: string) {
      const space = await createSpace(unique(name))
      made.push(space.id)
      return space
    }

    it('offers the other spaces, and not the one being worked in', async () => {
      const old = await makeOther('Old')
      await open()
      const options = Array.from(picker().options).map(option => option.value)
      expect(options).to.include(old.id)
      expect(options).to.not.include(current.id)
      expect(page.shadowRoot?.querySelector<HTMLButtonElement>('#delete-space')?.disabled).to.equal(
        true
      )
    })

    it('asks first, naming the space and saying Drive is not touched, then deletes it', async () => {
      const old = await makeOther('Old')
      await open()
      await choose(old.id)
      const modal = must(page._deleteSpaceModal.value)
      let said = ''
      modal.ask = async () => {
        said = modal.message
        return true
      }

      button('Delete Space').click()
      await until(() => !Array.from(picker().options).some(o => o.value === old.id), 'it to go')

      expect(said).to.contain(`"${old.name}"`)
      expect(said).to.contain('Google Drive is not touched')
      const { listSpaces } = await import('../src/js/space.ts')
      expect((await listSpaces()).map(space => space.id)).to.not.include(old.id)
      // (and the list of spaces above it follows)
      const selector = must(page.shadowRoot?.querySelector('select-space'))
      await until(() => !selector.shadowRoot?.textContent?.includes(old.name), 'the list to follow')
    })

    it('does nothing when it is not confirmed', async () => {
      const old = await makeOther('Old')
      await open()
      await choose(old.id)
      must(page._deleteSpaceModal.value).ask = async () => false
      button('Delete Space').click()
      await wait(100)
      const { getSpaceByName } = await import('../src/js/space.ts')
      expect(await getSpaceByName(old.name)).to.be.ok
    })

    it('does nothing when no space is chosen', async () => {
      await makeOther('Old')
      await open()
      let asked = false
      must(page._deleteSpaceModal.value).ask = async () => {
        asked = true
        return true
      }
      await page._handleDeleteSpace()
      expect(asked).to.equal(false)
    })

    it('says so when it cannot', async () => {
      const old = await makeOther('Old')
      await open()
      await choose(old.id)
      must(page._deleteSpaceModal.value).ask = async () => true
      // It went in the meantime, so there is nothing to delete
      await deleteSpace(old.id)

      button('Delete Space').click()
      await until(() => text().includes('Failed to delete the space'), 'the failure to be shown')
      expect(text()).to.contain('not found')
    })

    it('shows nothing to delete when it cannot list the spaces', async () => {
      await makeOther('Old')
      const real = SpaceDB.prototype.getAllSpaces
      SpaceDB.prototype.getAllSpaces = () => Promise.reject(new Error('unreadable'))
      try {
        await open()
        expect(page.shadowRoot?.querySelector('select#space-to-delete')).to.equal(null)
      } finally {
        SpaceDB.prototype.getAllSpaces = real
      }
    })
  })
})
