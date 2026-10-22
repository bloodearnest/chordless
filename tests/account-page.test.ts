/**
 * Account and Teams (account-page.ts): the account, then the spaces on this device with the one in
 * use first, switching, and the link that makes a Team. The sign-in is the fake service worker's.
 */
import { expect, fixture, html } from '@open-wc/testing'
import { AccountStateEvent } from '../src/components/account-card.ts'
import type { AccountPage } from '../src/components/account-page.ts'
import { type AppModal, ModalCloseEvent } from '../src/components/app-modal.ts'
import '../src/components/account-page.ts'
import type { SpaceCard } from '../src/components/space-card.ts'
import {
  SpaceManageEvent,
  SpaceSwitchEvent,
  SpaceSyncedEvent,
} from '../src/components/space-card.ts'
import { SpaceGoneEvent } from '../src/components/space-manager.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  renameSpace,
  setCurrentSpace,
} from '../src/js/space.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

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
    for (let i = 0; i < 50 && el._spaces.length === 0; i++) await wait(20)
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
    expect(cards(el).map(card => card.space.id)).to.include.members([first.id, second.id])
    expect(el.shadowRoot?.querySelector('a#create-team')?.getAttribute('href')).to.equal(
      '/account/new'
    )
    expect(el.shadowRoot?.querySelector('storage-summary')).to.not.equal(null)
    expect(el.shadowRoot?.textContent).to.contain('invite link')
  })

  it('puts the space in use first, and marks only it', async () => {
    const first = await space('First')
    const second = await space('Second')
    await setCurrentSpace(second.id, second.name)
    const el = await page()
    const shown = cards(el)
    expect(shown[0].space.id).to.equal(second.id)
    expect(shown.filter(card => card.current).map(card => card.space.id)).to.deep.equal([second.id])
    expect(shown.some(card => card.space.id === first.id)).to.equal(true)
  })

  it('hands the sign-in on to the cards', async () => {
    await space('First')
    const el = await page()
    el.shadowRoot?.querySelector('account-card')?.dispatchEvent(new AccountStateEvent('expired'))
    await el.updateComplete
    expect(cards(el).every(card => card.signIn === 'expired')).to.equal(true)
  })

  it('switches to the space asked for, and starts the app afresh', async () => {
    const first = await space('First')
    const second = await space('Second')
    await setCurrentSpace(first.id, first.name)
    const el = await page()
    let reloads = 0
    el.reload = () => {
      reloads++
    }
    must(el.shadowRoot?.querySelector('space-card')).dispatchEvent(new SpaceSwitchEvent(second.id))
    for (let i = 0; i < 50 && reloads === 0; i++) await wait(20)
    expect(reloads).to.equal(1)
    expect(getCurrentSpace().id).to.equal(second.id)
  })

  it('reads the spaces again when a sync may have renamed one', async () => {
    const first = await space('First')
    const el = await page()
    const renamed = `Renamed ${crypto.randomUUID().slice(0, 8)}`
    await renameSpace(first.id, renamed)
    must(el.shadowRoot?.querySelector('space-card')).dispatchEvent(new SpaceSyncedEvent())
    for (let i = 0; i < 50 && !cards(el).some(card => card.space.name === renamed); i++) {
      await wait(20)
    }
    expect(cards(el).some(card => card.space.name === renamed)).to.equal(true)
  })

  describe('managing a space', () => {
    const modal = (el: AccountPage) => must(el.shadowRoot?.querySelector<AppModal>('app-modal'))
    const manager = (el: AccountPage) => el.shadowRoot?.querySelector('space-manager') ?? null

    async function manage(el: AccountPage, id: string) {
      const card = must(cards(el).find(each => each.space.id === id))
      card.dispatchEvent(new SpaceManageEvent(id))
      for (let i = 0; i < 50 && !modal(el).open; i++) await wait(20)
      await el.updateComplete
    }

    it('opens a modal named for the space, with everything to do with it, over the list', async () => {
      const first = await space('First')
      const el = await page()
      expect(modal(el).open).to.equal(false)
      expect(manager(el)).to.equal(null)

      await manage(el, first.id)
      expect(modal(el).open).to.equal(true)
      expect(modal(el).heading).to.equal(first.name)
      expect(manager(el)?.spaceId).to.equal(first.id)
      expect(el.shadowRoot?.querySelector('space-card')).to.not.equal(null)
    })

    it('goes when closed, and reads the list again, as what was done in it may have changed it', async () => {
      const first = await space('First')
      const el = await page()
      await manage(el, first.id)
      const renamed = `Renamed ${crypto.randomUUID().slice(0, 8)}`
      await renameSpace(first.id, renamed)
      modal(el).close()
      for (let i = 0; i < 50 && !cards(el).some(card => card.space.name === renamed); i++) {
        await wait(20)
      }
      expect(manager(el)).to.equal(null)
      expect(cards(el).some(card => card.space.name === renamed)).to.equal(true)
    })

    it('stays open when a question asked inside it closes', async () => {
      const first = await space('First')
      const el = await page()
      await manage(el, first.id)
      must(manager(el)).dispatchEvent(new ModalCloseEvent())
      await wait(50)
      expect(modal(el).open).to.equal(true)
      expect(manager(el)).to.not.equal(null)
    })

    it('closes, and shows the list without it, when the space is gone', async () => {
      const first = await space('First')
      await space('Second')
      const el = await page()
      await manage(el, first.id)
      await deleteSpace(first.id)
      must(manager(el)).dispatchEvent(new SpaceGoneEvent())
      for (let i = 0; i < 50 && modal(el).open; i++) await wait(20)
      expect(modal(el).open).to.equal(false)
      for (let i = 0; i < 50 && cards(el).some(card => card.space.id === first.id); i++) {
        await wait(20)
      }
      expect(cards(el).some(card => card.space.id === first.id)).to.equal(false)
    })

    it('does nothing for a space that is not on the list', async () => {
      const el = await page()
      el.dispatchEvent(new SpaceManageEvent('no-such-space'))
      await wait(50)
      expect(modal(el).open).to.equal(false)
    })
  })
})
