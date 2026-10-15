/** The home page as it is shown: the setlists, the welcome card, and creating a setlist */
import { expect } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import type { SetlistDetailsForm } from '../src/components/setlist-details-form.ts'
import { SetlistDetailsSaveEvent } from '../src/components/setlist-details-form.ts'
import { type ChordlessDB, getCurrentDB } from '../src/js/db.ts'
import { setRouter } from '../src/js/navigation.ts'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  setCurrentOrganisation,
  setOrganisationReadOnly,
} from '../src/js/organisation.ts'
import '../src/js/views/home-view.ts'
import { type HomeView, sharedGroup } from '../src/js/views/home-view.ts'
import { makeSetlist } from './builders.ts'
import { FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('sharedGroup', () => {
  it('is no group for no setlists', () => {
    expect(sharedGroup([])).to.deep.equal([])
  })

  it('opens each setlist at its link, naming its leader', () => {
    const [group] = sharedGroup([
      makeSetlist({
        id: 'a',
        date: '2026-10-25',
        owner: 'Ann',
        received: { fileId: 'file/1' },
      } as never),
      makeSetlist({ id: 'b', date: '2026-10-18', owner: '', songs: undefined } as never),
    ])
    expect(group.expanded).to.equal(true)
    expect(group.setlists[0].url).to.equal('/s/file%2F1')
    expect(group.setlists[0].displayName).to.contain('· Ann')
    expect(group.setlists[1].url).to.equal('/s/')
    expect(group.setlists[1].displayName).to.not.contain('·')
    expect(group.setlists[1].songCount).to.equal(0)
  })
})

describe('the home view', () => {
  let before: { id: string | null; name: string }
  let organisationId: string
  let db: ChordlessDB
  let outlet: HTMLElement
  let view: HomeView
  let visited: string[]
  const realAlert = window.alert
  let alerts: string[]

  beforeEach(async () => {
    visited = []
    alerts = []
    window.alert = (message?: string) => {
      alerts.push(String(message))
    }
    setRouter({
      navigate: async (url: string) => {
        visited.push(url)
        return true
      },
    })
    before = getCurrentOrganisation()
    const organisation = await createOrganisation(`Home ${crypto.randomUUID().slice(0, 8)}`)
    organisationId = organisation.id
    await setCurrentOrganisation(organisation.id, organisation.name)
    db = await getCurrentDB()
    outlet = document.createElement('div')
    document.body.append(outlet)
  })

  afterEach(async () => {
    view?.remove()
    outlet.remove()
    setRouter(null)
    window.alert = realAlert
    await setOrganisationReadOnly(organisationId, false)
    await deleteOrganisation(organisationId)
    if (before.id) await setCurrentOrganisation(before.id, before.name)
  })

  async function open(restoredState?: HomeView['restoredState']) {
    view = document.createElement('home-view')
    view.route = { name: 'home' }
    view.restoredState = restoredState
    outlet.append(view)
    await view.updateComplete
    // (the setlists load after it first draws)
    const loading = () =>
      !view.querySelector('#setlist-list') || view.querySelector('status-message[state="loading"]')
    for (let i = 0; i < 250 && loading(); i++) await wait(20)
    await wait(30)
  }
  const modal = () => must(view.querySelector<AppModal>('app-modal'))
  const form = () => must(view.querySelector<SetlistDetailsForm>('setlist-details-form'))

  it('shows the welcome card to someone with no setlists', async () => {
    await open()
    expect(view.querySelector('welcome-card')).to.not.equal(null)
    expect(view.querySelector('setlist-group')).to.equal(null)
  })

  it('shows the setlists by year, opening the current year, or the years it was left with', async () => {
    const thisYear = new Date().getFullYear()
    await db.saveSetlist(makeSetlist({ id: 'now', date: `${thisYear}-01-04` }))
    await db.saveSetlist(makeSetlist({ id: 'old', date: '2001-03-04' }))
    await open()
    const groups = [...view.querySelectorAll('setlist-group')] as Array<
      HTMLElement & { year: string; expanded: boolean }
    >
    expect(groups.map(group => group.year)).to.deep.equal([String(thisYear), '2001'])
    expect(groups.map(group => group.expanded)).to.deep.equal([true, false])
    view.remove()

    await open({ expanded: { '2001': true, [String(thisYear)]: false } })
    const again = [...view.querySelectorAll('setlist-group')] as Array<
      HTMLElement & { expanded: boolean }
    >
    expect(again.map(group => group.expanded)).to.deep.equal([false, true])
  })

  it('keeps which years are open, and the scroll, for when it is come back to', async () => {
    await db.saveSetlist(makeSetlist({ id: 'a', date: '2001-03-04' }))
    await open()
    const state = view.captureViewState()
    expect(state.expanded).to.deep.equal({ '2001': false })
    expect(state).to.have.property('scroll')
  })

  it('says so when the setlists cannot be read', async () => {
    const real = Object.getPrototypeOf(db).getAllSetlists
    Object.getPrototypeOf(db).getAllSetlists = () => Promise.reject(new Error('no db'))
    try {
      await open()
    } finally {
      Object.getPrototypeOf(db).getAllSetlists = real
    }
    expect(view.querySelector('status-message[state="error"]')).to.not.equal(null)
  })

  it('offers no way to create a setlist in a view-only organisation', async () => {
    await setOrganisationReadOnly(organisationId, true)
    await open()
    expect(view.querySelector('#create-setlist-button')).to.equal(null)
  })

  describe('creating a setlist', () => {
    it('opens a form with next Sunday’s service, led by the user', async () => {
      await open()
      view.querySelector<HTMLButtonElement>('#create-setlist-button')?.click()
      await wait(100)
      expect(modal().open).to.equal(true)
      expect(form().setlist?.time).to.equal('10:30')
      expect(new Date(`${form().setlist?.date}T12:00`).getDay()).to.equal(0)
    })

    it('is led by the user who is signed in, who is recorded as having made it', async () => {
      const auth = installFakeAuthWorker(new FakeAuthWorker())
      auth.worker.stored = {
        blob: 'blob',
        metadata: {
          user: {
            name: 'Ann Smith',
            email: 'ann@example.com',
            picture: null,
            given_name: null,
            family_name: null,
            sub: 's',
          },
        },
        updated_at: 'now',
      }
      try {
        await open()
        view.querySelector<HTMLButtonElement>('#create-setlist-button')?.click()
        await wait(150)
        expect(form().setlist?.owner).to.equal('Ann Smith')
        expect(form().setlist?.ownerId).to.equal('ann@example.com')
        form().dispatchEvent(
          new SetlistDetailsSaveEvent({
            date: '2026-11-08',
            time: '',
            type: 'Other',
            name: 'By Ann',
            owner: 'Ann Smith',
            ownerId: 'ann@example.com',
          })
        )
        await wait(150)
        const [saved] = await db.getAllSetlists()
        expect(saved.createdBy).to.equal('ann@example.com')
      } finally {
        auth.uninstall()
      }
    })

    it('saves it, and goes to it', async () => {
      await open()
      view.querySelector<HTMLButtonElement>('#create-setlist-button')?.click()
      await wait(100)
      form().dispatchEvent(
        new SetlistDetailsSaveEvent({
          date: '2026-11-01',
          time: '10:30',
          type: 'Church Service',
          name: 'Created',
          owner: '',
          ownerId: '',
        })
      )
      await wait(100)
      expect(visited).to.have.length(1)
      expect(visited[0]).to.match(/^\/setlist\//)
      expect((await db.getAllSetlists()).map(setlist => setlist.name)).to.deep.equal(['Created'])
    })

    it('says so when it cannot be saved', async () => {
      await open()
      const real = Object.getPrototypeOf(db).saveSetlist
      Object.getPrototypeOf(db).saveSetlist = () => Promise.reject(new Error('disk full'))
      try {
        form().dispatchEvent(
          new SetlistDetailsSaveEvent({
            date: '2026-11-01',
            time: '',
            type: 'Other',
            name: '',
            owner: '',
            ownerId: '',
          })
        )
        await wait(100)
      } finally {
        Object.getPrototypeOf(db).saveSetlist = real
      }
      expect(alerts).to.deep.equal(['Failed to create setlist: disk full'])
      expect(visited).to.deep.equal([])
    })
  })
})
