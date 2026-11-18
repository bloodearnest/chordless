/**
 * Account and Teams (account-page.ts): the account, then the spaces on this device with the one in
 * use first, switching, and the link that makes a Team. The sign-in is the fake service worker's.
 */
import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import { AccountStateEvent } from '../src/components/account-card.ts'
import type { AccountPage } from '../src/components/account-page.ts'
import '../src/components/account-page.ts'
import type { SpaceCard } from '../src/components/space-card.ts'
import {
  SpaceConnectGoogleEvent,
  SpaceDefaultEvent,
  SpaceManageEvent,
  SpaceSyncedEvent,
} from '../src/components/space-card.ts'
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
    expect(el.shadowRoot?.querySelector('h2')?.textContent).to.equal('Personal and Team Spaces')
    expect(cards(el).map(card => card.space.id)).to.include.members([first.id, second.id])
    expect(el.shadowRoot?.querySelector('a#create-team')?.getAttribute('href')).to.equal(
      '/account/new'
    )
    expect(el.shadowRoot?.querySelector('storage-summary')).to.not.equal(null)
    expect(el.shadowRoot?.textContent).to.contain('invite link')
  })

  it('keeps the spaces in the order they were added, whichever is in use, and marks only that one', async () => {
    const first = await space('First')
    await nextTimestamp()
    const second = await space('Second')
    const order = () => cards(el).map(card => card.space.id)
    await setCurrentSpace(first.id, first.name)
    const el = await page()
    const mine = order().filter(id => id === first.id || id === second.id)
    expect(mine).to.deep.equal([first.id, second.id])
    expect(
      cards(el)
        .filter(card => card.current)
        .map(card => card.space.id)
    ).to.deep.equal([first.id])

    await setCurrentSpace(second.id, second.name)
    await el.load()
    await el.updateComplete
    expect(order().filter(id => id === first.id || id === second.id)).to.deep.equal([
      first.id,
      second.id,
    ])
    expect(
      cards(el)
        .filter(card => card.current)
        .map(card => card.space.id)
    ).to.deep.equal([second.id])
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

  describe('connecting Google to sync a Personal space', () => {
    afterEach(() => clearToasts())

    it('tells the cards when the sign-in is by email alone, and not otherwise', async () => {
      await space('First')
      const el = await page()
      el.shadowRoot
        ?.querySelector('account-card')
        ?.dispatchEvent(new AccountStateEvent('no-drive', true))
      await el.updateComplete
      expect(cards(el).every(card => card.emailOnly)).to.equal(true)
      el.shadowRoot
        ?.querySelector('account-card')
        ?.dispatchEvent(new AccountStateEvent('signed-in'))
      await el.updateComplete
      expect(cards(el).some(card => card.emailOnly)).to.equal(false)
    })

    it('connects Google when a card asks, and reads the sign-in again', async () => {
      await space('First')
      const el = await page()
      let connected = 0
      el.connectGoogle = async () => void connected++
      let refreshed = 0
      const account = must(el.shadowRoot?.querySelector('account-card'))
      account.refresh = async () => void refreshed++
      must(cards(el)[0]).dispatchEvent(new SpaceConnectGoogleEvent())
      await waitUntil(() => refreshed === 1, 'the sign-in to be read again')
      expect(connected).to.equal(1)
      expect(shownToast()).to.equal(null)
    })

    it('says so when Google could not be connected, and reads the sign-in all the same', async () => {
      await space('First')
      const el = await page()
      el.connectGoogle = async () => {
        throw new Error('That Google account is already used by another Chordless account')
      }
      let refreshed = 0
      must(el.shadowRoot?.querySelector('account-card')).refresh = async () => void refreshed++
      must(cards(el)[0]).dispatchEvent(new SpaceConnectGoogleEvent())
      await waitUntil(() => shownToast(), 'the message')
      expect(shownToast()?.message).to.contain('connect Google')
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
        let message = ''
        await el.connectGoogle().catch(error => {
          message = error.message
        })
        expect(message).to.equal('access_denied')
      } finally {
        ;(window as { google?: unknown }).google = real
      }
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

    it('has no modals: everything to do with a space is on that page', async () => {
      await space('First')
      const el = await page()
      expect(el.shadowRoot?.querySelector('app-modal')).to.equal(null)
      expect(el.shadowRoot?.querySelector('space-manager')).to.equal(null)
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
      await waitUntil(() => message(el).includes('Could not look for your teams: offline'))
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
