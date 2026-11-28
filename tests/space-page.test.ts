/**
 * The page of one space (space-page.ts): its sections by the kind of space, and what it does when the space goes
 * from this device or the person leaves the Team. The sign-in is the fake service worker's.
 */
import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import '../src/components/space-page.ts'
import type { SpacePage } from '../src/components/space-page.ts'
import { TeamLeftEvent, TeamSharingStoppedEvent } from '../src/components/team-membership-panel.ts'
import type { Route } from '../src/js/router.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  setCurrentSpace,
  updateSpace,
} from '../src/js/space.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('space-page', () => {
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

  async function space(
    name: string,
    team?: { id: string; role: 'owner' | 'admin' | 'writer' | 'reader'; churchId?: string }
  ) {
    const created = await createSpace(`${name} ${crypto.randomUUID().slice(0, 8)}`)
    made.push(created.id)
    return team ? updateSpace(created.id, { team }) : created
  }

  async function open(route: Route) {
    const el = await fixture<SpacePage>(html`<space-page .route=${route}></space-page>`)
    const went: { url: string; fresh: boolean }[] = []
    el.go = (url, options) => void went.push({ url, fresh: options?.fresh === true })
    await waitUntil(() => el._space || el._missing, 'the space to be read')
    await el.updateComplete
    return { el, went }
  }
  const text = (el: SpacePage) => (el.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')

  it('shows a Personal space with who leads its setlists, and no Team sections', async () => {
    const mine = await space('Band')
    const { el } = await open({ name: 'space', spaceId: mine.id })
    expect(el.shadowRoot?.querySelector('h2')?.textContent).to.contain(mine.name)
    expect(el.shadowRoot?.querySelector('a.back')?.getAttribute('href')).to.equal('/account')
    expect(el.shadowRoot?.querySelector('people-list')?.space?.id).to.equal(mine.id)
    expect(el.shadowRoot?.querySelector('space-manager')).to.equal(null) // (its data is on the Account page)
    expect(el.shadowRoot?.querySelector('team-membership-panel')).to.equal(null)
    expect(el.shadowRoot?.querySelector('team-licence-panel')).to.equal(null)
    expect(el.shadowRoot?.querySelector('team-storage-panel')).to.equal(null)
  })

  it('shows a Team with its kind and role, its people, licence and storage', async () => {
    const team = await space('Choir', { id: `space-${crypto.randomUUID()}`, role: 'writer' })
    const { el } = await open({ name: 'space', spaceId: team.id })
    expect(text(el)).to.contain('Team')
    expect(text(el)).to.contain('Worship leader')
    expect(el.shadowRoot?.querySelector('people-list')?.space?.id).to.equal(team.id)
    expect(el.shadowRoot?.querySelector('team-membership-panel')?.space?.id).to.equal(team.id)
    expect(el.shadowRoot?.querySelector('team-licence-panel')).to.not.equal(null)
    expect(el.shadowRoot?.querySelector('team-storage-panel')).to.not.equal(null)
  })

  it("sends a church's team to its church's page, with none of a Drive team's sections", async () => {
    const team = await space('Worship', {
      id: `space-${crypto.randomUUID()}`,
      role: 'writer',
      churchId: 'church',
    })
    const { el } = await open({ name: 'space', spaceId: team.id })
    expect(text(el)).to.contain("on the church's page")
    expect(el.shadowRoot?.querySelector('#church-link')?.getAttribute('href')).to.equal(
      '/account/churches'
    )
    for (const section of [
      'people-list',
      'team-membership-panel',
      'team-licence-panel',
      'team-storage-panel',
    ])
      expect(el.shadowRoot?.querySelector(section), section).to.equal(null)
  })

  it('says a space is view only when it is, and a space still called Personal needs no label', async () => {
    const viewOnly = await space('Band')
    await updateSpace(viewOnly.id, { readOnly: true })
    const { el } = await open({ name: 'space', spaceId: viewOnly.id })
    expect(text(el)).to.contain('View only')
    expect(text(el)).to.contain('Personal')
    const own = await updateSpace((await space('Mine')).id, { name: 'Personal' })
    const second = await open({ name: 'space', spaceId: own.id })
    expect(second.el.shadowRoot?.querySelectorAll('.label').length).to.equal(0)
  })

  it('does not show a space whose route was replaced while it was being read', async () => {
    const one = await space('One')
    const two = await space('Two')
    const { el } = await open({ name: 'space', spaceId: one.id })
    const reading = el._load()
    el.route = { name: 'space', spaceId: two.id }
    await reading
    await waitUntil(() => el._space?.id === two.id, 'the second space')
    expect(el._space?.id).to.equal(two.id)
  })

  it('becomes a Personal space again when the owner stops sharing', async () => {
    const team = await space('Choir', { id: `space-${crypto.randomUUID()}`, role: 'owner' })
    const { el } = await open({ name: 'space', spaceId: team.id })
    expect(el.shadowRoot?.querySelector('team-membership-panel')).to.not.equal(null)
    await updateSpace(team.id, { team: undefined })
    must(el.shadowRoot?.querySelector('team-membership-panel')).dispatchEvent(
      new TeamSharingStoppedEvent()
    )
    await waitUntil(
      () => !el.shadowRoot?.querySelector('team-membership-panel'),
      'the page to update'
    )
    expect(el.shadowRoot?.querySelector('team-licence-panel')).to.equal(null)
    expect(el.shadowRoot?.querySelector('people-list')).to.not.equal(null)
  })

  it('says so when the space is not on this device', async () => {
    const { el } = await open({ name: 'space', spaceId: 'no-such-space' })
    expect(text(el)).to.contain('not on this device')
    expect(el.shadowRoot?.querySelector('space-manager')).to.equal(null)
  })

  it('reads the space again for another route, and ignores one that has been replaced', async () => {
    const one = await space('One')
    const two = await space('Two')
    const { el } = await open({ name: 'space', spaceId: one.id })
    el.route = { name: 'space', spaceId: two.id }
    await waitUntil(() => el._space?.id === two.id, 'the second space')
    expect(el.shadowRoot?.querySelector('h2')?.textContent).to.contain(two.name)
    // (a route that is not a space's shows nothing of it)
    el.route = undefined
    await waitUntil(() => el._missing, 'nothing to show')
    expect(text(el)).to.contain('not on this device')
  })

  it('goes back to the list when the person leaves the Team', async () => {
    const team = await space('Choir', { id: `space-${crypto.randomUUID()}`, role: 'reader' })
    const { el, went } = await open({ name: 'space', spaceId: team.id })
    must(el.shadowRoot?.querySelector('team-membership-panel')).dispatchEvent(new TeamLeftEvent())
    expect(went).to.deep.equal([{ url: '/account', fresh: false }])
  })

  it('stops listening when it is taken away', async () => {
    const mine = await space('Band')
    const { el, went } = await open({ name: 'space', spaceId: mine.id })
    el.remove()
    el.dispatchEvent(new TeamLeftEvent())
    expect(went).to.deep.equal([])
  })
})
