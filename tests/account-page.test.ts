/**
 * Account and Teams (account-page.ts): the account, then the spaces on this device with the one in
 * use first, switching, and the link that makes a Team. The sign-in is the fake service worker's.
 */
import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import { AccountLoadedEvent, AccountStateEvent } from '../src/components/account-card.ts'
import type { AccountPage } from '../src/components/account-page.ts'
import '../src/components/account-page.ts'
import type { AppModal } from '../src/components/app-modal.ts'
import {
  type SpaceCard,
  SpaceConnectDriveEvent,
  SpaceDataEvent,
  SpaceDefaultEvent,
  SpaceDisconnectDriveEvent,
  SpaceManageEvent,
  SpaceSyncedEvent,
} from '../src/components/space-card.ts'
import { SpaceGoneEvent } from '../src/components/space-manager.ts'
import { setAccountStorageKey } from '../src/js/account-info.ts'
import { getDefaultSpaceId, setDefaultSpaceId } from '../src/js/default-space.ts'
import type { SignInState } from '../src/js/google-auth.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  renameSpace,
  setCurrentSpace,
} from '../src/js/space.ts'
import { TeamSpacesAddedEvent } from '../src/js/team-memberships.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import {
  clearToasts,
  nextTimestamp,
  nothingFor,
  shownToast,
  suppressConsoleLogs,
} from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('account-page', () => {
  let uninstallWorker: () => void
  let before: { id: string | null; name: string }
  const made: string[] = []

  beforeEach(() => {
    ;({ uninstall: uninstallWorker } = installFakeAuthWorker())
    before = getCurrentSpace()
  })

  afterEach(async () => {
    uninstallWorker()
    for (const id of made.splice(0)) await deleteSpace(id).catch(() => {})
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  async function space(name: string) {
    const created = await createSpace(`${name} ${crypto.randomUUID().slice(0, 8)}`)
    made.push(created.id)
    return created
  }

  async function page() {
    const el = await fixture<AccountPage>(html`<account-page></account-page>`)
    // (it loads the list as it is added: loading it again waits for one that is done)
    await el.load()
    await el.updateComplete
    return el
  }
  const cards = (el: AccountPage) =>
    Array.from(el.shadowRoot?.querySelectorAll<SpaceCard>('space-card') ?? [])

  it('shows the account, a card for each space, a link to make a Team, and the device', async () => {
    const first = await space('First')
    const second = await space('Second')
    await setCurrentSpace(first.id, first.name)
    const el = await page()
    expect(el.shadowRoot?.querySelector('account-card')).to.not.equal(null)
    expect(el.shadowRoot?.querySelector('h2')?.textContent).to.equal('Personal space')
    expect(cards(el).map(card => card.space.id)).to.include.members([first.id, second.id])
    expect(el.shadowRoot?.querySelector('a#create-team')?.getAttribute('href')).to.equal(
      '/account/new'
    )
    expect(el.shadowRoot?.querySelector('storage-summary')).to.not.equal(null)
    expect(el.shadowRoot?.textContent).to.contain('invite link')
  })

  it('shows the teams first, then the personal space with what it is for, then churches once signed in', async () => {
    const own = await space('Own')
    const el = await page()
    el._spaces = [
      own,
      { ...own, id: 'team-space-1', name: 'Morning', team: { id: 't-1', role: 'writer' } },
    ]
    await el.updateComplete
    const root = must(el.shadowRoot)
    const sections = () => Array.from(root.querySelectorAll('section')).map(section => section.id)
    expect(root.querySelector('#team-spaces space-card')).to.not.equal(null)
    expect(root.querySelector('#personal-spaces .hint')?.textContent).to.contain('wedding')
    expect(sections().slice(0, 2)).to.deep.equal(['team-spaces', 'personal-spaces'])
    expect(root.querySelector('#churches-section')).to.equal(null)
    el.dispatchEvent(new AccountStateEvent('no-drive'))
    await el.updateComplete
    const church = root.querySelector<HTMLAnchorElement>('#churches-section a')
    expect(church?.textContent).to.contain('Register an organisation or church')
    expect(church?.getAttribute('href')).to.equal('/account/churches')
  })

  it('keeps the spaces in the order they were added, whichever is in use', async () => {
    const first = await space('First')
    await nextTimestamp()
    const second = await space('Second')
    const order = () => cards(el).map(card => card.space.id)
    await setCurrentSpace(first.id, first.name)
    const el = await page()
    expect(order().filter(id => id === first.id || id === second.id)).to.deep.equal([
      first.id,
      second.id,
    ])

    await setCurrentSpace(second.id, second.name)
    await el.load()
    await el.updateComplete
    expect(order().filter(id => id === first.id || id === second.id)).to.deep.equal([
      first.id,
      second.id,
    ])
  })

  it('hands the sign-in on to the cards', async () => {
    await space('First')
    const el = await page()
    el.shadowRoot?.querySelector('account-card')?.dispatchEvent(new AccountStateEvent('expired'))
    await el.updateComplete
    expect(cards(el).every(card => card.signIn === 'expired')).to.equal(true)
  })

  it('keeps the space asked for as the default, and marks only that one', async () => {
    const first = await space('First')
    await nextTimestamp()
    const second = await space('Second')
    const el = await page()
    const isDefault = () =>
      cards(el)
        .filter(card => card.isDefault)
        .map(card => card.space.id)
    try {
      setDefaultSpaceId(first.id)
      await el.load()
      await el.updateComplete
      expect(isDefault()).to.deep.equal([first.id])
      expect(cards(el).every(card => card.several)).to.equal(true)

      const card = must(cards(el).find(each => each.space.id === second.id))
      card.dispatchEvent(new SpaceDefaultEvent(second.id))
      await el.updateComplete
      expect(getDefaultSpaceId()).to.equal(second.id)
      expect(isDefault()).to.deep.equal([second.id])
    } finally {
      setDefaultSpaceId(null)
    }
  })

  it('reads the spaces again when a sync may have renamed one', async () => {
    const first = await space('First')
    const el = await page()
    const renamed = `Renamed ${crypto.randomUUID().slice(0, 8)}`
    await renameSpace(first.id, renamed)
    must(el.shadowRoot?.querySelector('space-card')).dispatchEvent(new SpaceSyncedEvent())
    await waitUntil(() => cards(el).some(card => card.space.name === renamed))
    expect(cards(el).some(card => card.space.name === renamed)).to.equal(true)
  })

  describe('connecting Google Drive to sync a Personal space', () => {
    afterEach(() => clearToasts())

    it('connects Drive when a card asks, as an email sign-in needs, and reads the sign-in again', async () => {
      await space('First')
      const el = await page()
      el.shadowRoot
        ?.querySelector('account-card')
        ?.dispatchEvent(new AccountStateEvent('no-drive', true))
      const asked: boolean[] = []
      el.connectDrive = async emailOnly => void asked.push(emailOnly)
      let refreshed = 0
      const account = must(el.shadowRoot?.querySelector('account-card'))
      account.refresh = async () => void refreshed++
      must(cards(el)[0]).dispatchEvent(new SpaceConnectDriveEvent())
      await waitUntil(() => refreshed === 1, 'the sign-in to be read again')
      expect(asked).to.deep.equal([true])
      expect(shownToast()).to.equal(null)
    })

    it('asks for Drive alone of an account that has Google already', async () => {
      await space('First')
      const el = await page()
      el.shadowRoot
        ?.querySelector('account-card')
        ?.dispatchEvent(new AccountStateEvent('no-drive', false))
      const asked: boolean[] = []
      el.connectDrive = async emailOnly => void asked.push(emailOnly)
      must(el.shadowRoot?.querySelector('account-card')).refresh = async () => {}
      must(cards(el)[0]).dispatchEvent(new SpaceConnectDriveEvent())
      await waitUntil(() => asked.length === 1)
      expect(asked).to.deep.equal([false])
    })

    it('says so when Drive could not be connected, and reads the sign-in all the same', async () => {
      await space('First')
      const el = await page()
      el.connectDrive = async () => {
        throw new Error('That Google account is already used by another Chordless account')
      }
      let refreshed = 0
      must(el.shadowRoot?.querySelector('account-card')).refresh = async () => void refreshed++
      must(cards(el)[0]).dispatchEvent(new SpaceConnectDriveEvent())
      await waitUntil(() => shownToast(), 'the message')
      expect(shownToast()?.message).to.contain('connect Google Drive')
      expect(shownToast()?.details).to.contain('already used')
      expect(refreshed).to.equal(1)
    })

    it('starts Google’s sign-in by default, which says when the window gives nothing', async () => {
      const real = (window as { google?: unknown }).google
      ;(window as { google?: unknown }).google = {
        accounts: {
          oauth2: {
            initCodeClient: (config: { callback: (response: object) => void }) => ({
              requestCode: () => config.callback({ error: 'access_denied' }),
            }),
          },
        },
      }
      try {
        const el = await page()
        for (const emailOnly of [true, false]) {
          let message = ''
          await el.connectDrive(emailOnly).catch(error => {
            message = error.message
          })
          expect(message).to.equal('access_denied')
        }
      } finally {
        ;(window as { google?: unknown }).google = real
      }
    })

    it('starts from the Drive it last knew of, so the Personal card names it while the Worker is asked', async () => {
      const key = 'chordless:account:test-account-page'
      setAccountStorageKey(key)
      localStorage.setItem(
        key,
        JSON.stringify({
          name: null,
          emails: [],
          googleEmail: null,
          drive: { email: 'kept@gmail.example' },
        })
      )
      try {
        await space('First')
        const el = await page()
        expect(cards(el)[0].driveEmail).to.equal('kept@gmail.example')
      } finally {
        localStorage.removeItem(key)
        setAccountStorageKey('chordless:account')
      }
    })

    it('shows the Drive the account syncs through on the Personal card', async () => {
      await space('First')
      const el = await page()
      el.shadowRoot?.querySelector('account-card')?.dispatchEvent(
        new AccountLoadedEvent({
          name: null,
          emails: [],
          googleEmail: null,
          drive: { email: 'ann@gmail.example' },
        })
      )
      await el.updateComplete
      expect(cards(el)[0].driveEmail).to.equal('ann@gmail.example')
    })
  })

  describe('disconnecting Google Drive', () => {
    afterEach(() => clearToasts())

    const answer = async (el: AccountPage, confirm: boolean) => {
      const modal = must(el.shadowRoot?.querySelector<AppModal>('app-modal[heading^="Disconnect"]'))
      await waitUntil(() => modal.open, 'the question')
      await modal.updateComplete
      must(
        modal.shadowRoot?.querySelector<HTMLElement>(
          confirm ? '.modal-btn-confirm' : '.modal-btn-cancel'
        )
      ).click()
    }

    it('asks first, then disconnects for every device, and says so', async () => {
      await space('First')
      const el = await page()
      let disconnected = 0
      el.disconnectDrive = async () => {
        disconnected++
        return { revoked: true }
      }
      let refreshed = 0
      must(el.shadowRoot?.querySelector('account-card')).refresh = async () => void refreshed++
      must(cards(el)[0]).dispatchEvent(new SpaceDisconnectDriveEvent())
      await answer(el, true)
      await waitUntil(() => shownToast(), 'the message')
      expect(shownToast()?.message).to.contain('Google Drive is disconnected.')
      expect(disconnected).to.equal(1)
      expect(refreshed).to.equal(1)
    })

    it('says when Google’s access was left in place for a Team the person owns', async () => {
      await space('First')
      const el = await page()
      el.disconnectDrive = async () => ({ revoked: false })
      must(el.shadowRoot?.querySelector('account-card')).refresh = async () => {}
      must(cards(el)[0]).dispatchEvent(new SpaceDisconnectDriveEvent())
      await answer(el, true)
      await waitUntil(() => shownToast(), 'the message')
      expect(shownToast()?.message).to.contain('left in place')
    })

    it('does nothing when it is not confirmed', async () => {
      await space('First')
      const el = await page()
      let disconnected = 0
      el.disconnectDrive = async () => {
        disconnected++
        return { revoked: true }
      }
      must(cards(el)[0]).dispatchEvent(new SpaceDisconnectDriveEvent())
      await answer(el, false)
      await nothingFor(50)
      expect(disconnected).to.equal(0)
      expect(shownToast()).to.equal(null)
    })

    it('says so when it could not be done', async () => {
      await space('First')
      const el = await page()
      el.disconnectDrive = async () => {
        throw new Error('Google did not revoke the access')
      }
      must(el.shadowRoot?.querySelector('account-card')).refresh = async () => {}
      must(cards(el)[0]).dispatchEvent(new SpaceDisconnectDriveEvent())
      await answer(el, true)
      await waitUntil(() => shownToast(), 'the message')
      expect(shownToast()?.message).to.contain('disconnect Google Drive')
      expect(shownToast()?.details).to.contain('did not revoke')
    })

    it('is for someone who is signed in: by default it needs the session to ask the Worker', async () => {
      const el = await page()
      let failed = false
      await el.disconnectDrive().catch(() => {
        failed = true
      })
      expect(failed).to.equal(true)
    })
  })

  describe('managing a space', () => {
    it('goes to the space’s own page when asked to manage it', async () => {
      const first = await space('First')
      const el = await page()
      const went: string[] = []
      el.go = url => void went.push(url)
      must(cards(el).find(each => each.space.id === first.id)).dispatchEvent(
        new SpaceManageEvent(first.id)
      )
      expect(went).to.deep.equal([`/account/space/${first.id}`])
    })

    describe('its data', () => {
      const dataModal = (el: AccountPage) =>
        must(el.shadowRoot?.querySelector<AppModal>('app-modal'))

      it('shows the space’s data in a dialogue when asked, and nothing for a space it does not know', async () => {
        const first = await space('First')
        const el = await page()
        expect(el.shadowRoot?.querySelector('space-manager')).to.equal(null)
        must(cards(el)[0]).dispatchEvent(new SpaceDataEvent('no-such-space'))
        await el.updateComplete
        expect(el.shadowRoot?.querySelector('space-manager')).to.equal(null)
        must(cards(el).find(each => each.space.id === first.id)).dispatchEvent(
          new SpaceDataEvent(first.id)
        )
        await waitUntil(() => dataModal(el).open, 'the dialogue')
        expect(el.shadowRoot?.querySelector('space-manager')?.spaceId).to.equal(first.id)
        expect(dataModal(el).heading).to.contain('First')
      })

      it('lets go of the space when the dialogue is closed', async () => {
        const first = await space('First')
        const el = await page()
        must(cards(el)[0]).dispatchEvent(new SpaceDataEvent(first.id))
        await waitUntil(() => dataModal(el).open, 'the dialogue')
        dataModal(el).close()
        await waitUntil(() => el._data === null, 'the space to be let go')
        expect(el.shadowRoot?.querySelector('space-manager')).to.equal(null)
      })

      it('closes when the space is deleted, and starts afresh only if it was the one in use', async () => {
        const first = await space('First')
        const el = await page()
        let shown = 0
        el.show = () => void shown++
        must(cards(el)[0]).dispatchEvent(new SpaceDataEvent(first.id))
        await waitUntil(() => dataModal(el).open, 'the dialogue')
        must(el.shadowRoot?.querySelector('space-manager')).dispatchEvent(new SpaceGoneEvent(false))
        await waitUntil(() => !dataModal(el).open, 'the dialogue to close')
        expect(shown).to.equal(0)
        // (the dialogue's own close event comes a moment later: asked again straight away, it would close the new one)
        await nothingFor(100)
        must(cards(el)[0]).dispatchEvent(new SpaceDataEvent(first.id))
        await waitUntil(() => dataModal(el).open, 'the dialogue again')
        must(el.shadowRoot?.querySelector('space-manager')).dispatchEvent(new SpaceGoneEvent(true))
        expect(shown).to.equal(1)
      })

      it('stops listening when it is taken away', async () => {
        const el = await page()
        el.remove()
        el.dispatchEvent(new SpaceGoneEvent(true))
        el.dispatchEvent(new SpaceDataEvent('x'))
        expect(el._data).to.equal(null)
      })
    })
  })

  describe('looking for the teams a person is in', () => {
    const button = (el: AccountPage) =>
      el.shadowRoot?.querySelector<HTMLButtonElement>('button#look-for-teams') ?? null
    const message = (el: AccountPage) =>
      el.shadowRoot?.querySelector('#look-message')?.textContent?.replace(/\s+/g, ' ') ?? ''
    // (the account card tells the page how the sign-in stands, once it has asked: let it, then say)
    const signedIn = async (el: AccountPage, state: SignInState = 'signed-in') => {
      await nothingFor(100)
      el.dispatchEvent(new AccountStateEvent(state))
      await el.updateComplete
    }

    it('is offered only when signed in', async () => {
      const el = await page()
      await signedIn(el, 'signed-out')
      expect(button(el)).to.equal(null)
      await signedIn(el)
      expect(button(el)).to.not.equal(null)
    })

    it('asks for the declined teams too, and says what it added', async () => {
      const el = await page()
      await signedIn(el)
      const asked: unknown[] = []
      const added = await space('Choir')
      el.checkTeams = async options => {
        asked.push(options)
        return { added: [added], declined: [] }
      }
      must(button(el)).click()
      await waitUntil(() => message(el).includes('Added'), 'the answer')
      expect(asked).to.deep.equal([{ force: true, includeDeclined: true }])
      expect(message(el)).to.contain(added.name)
      expect(button(el)?.disabled).to.equal(false)
    })

    it('says so when there is nothing to add', async () => {
      const el = await page()
      await signedIn(el)
      el.checkTeams = async () => ({ added: [], declined: [] })
      must(button(el)).click()
      await waitUntil(() => message(el).includes('Every team you are in'), 'the answer')
    })

    it('says so, and can be tried again, when it could not look', async () => {
      const el = await page()
      await signedIn(el)
      el.checkTeams = () => Promise.reject(new Error('offline'))
      must(button(el)).click()
      await waitUntil(() => message(el).includes('Could not look for your teams.'))
      expect(button(el)?.disabled).to.equal(false)
    })

    it('is held while it looks', async () => {
      const el = await page()
      await signedIn(el)
      let finish = () => {}
      el.checkTeams = () =>
        new Promise(resolve => {
          finish = () => resolve({ added: [], declined: [] })
        })
      must(button(el)).click()
      await el.updateComplete
      expect(button(el)?.disabled).to.equal(true)
      expect(button(el)?.textContent).to.contain('Looking')
      finish()
      await waitUntil(() => button(el)?.disabled === false, 'it to be done')
    })

    it('lists the spaces again when teams were added by itself', async () => {
      const el = await page()
      const added = await space('Added')
      expect(cards(el).map(card => card.space.id)).to.not.include(added.id)
      window.dispatchEvent(new TeamSpacesAddedEvent([added]))
      await waitUntil(() => cards(el).some(card => card.space.id === added.id), 'the new card')
    })
  })
})
