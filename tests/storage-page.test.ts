/**
 * The storage page's Google Drive section: what it shows of the sign-in, and logging out. The
 * service worker that keeps the sign-in is a fake one (see fake-auth-worker.ts), and Drive a fake
 * Drive, which the rest of the page asks about itself.
 */

import { expect } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import '../src/components/storage-page.ts'
import type { StoragePage } from '../src/components/storage-page.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('the storage page, signed in to Google', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
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

  async function open(signedIn = true) {
    if (signedIn) {
      worker.stored = {
        blob: 'encrypted-blob',
        metadata: {
          access_token: 'token',
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
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
    ;({ worker, uninstall: uninstallWorker } = installFakeAuthWorker())
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

  it('offers to connect when nobody is signed in', async () => {
    await open(false)
    expect(text()).to.contain('Not Connected')
    expect(text()).not.to.contain('Logout')
  })

  describe('logging out', () => {
    it('asks first, then deletes the sign-in and says so', async () => {
      await open()

      button('Logout').click()
      await answerLogout(true)
      await until(() => text().includes('Not Connected'), 'the page to show it is signed out')

      expect(worker.messages.map(m => m.type)).to.include('DELETE_BLOB')
      expect(worker.stored).to.equal(undefined)
      expect(page.isAuthenticated).to.equal(false)
      expect(text()).to.contain('Successfully logged out')
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
})
