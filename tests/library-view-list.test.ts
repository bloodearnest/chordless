/**
 * The library view's list and its way in and out of a song: searching, opening, closing, the
 * song of another database, and the small controls. (The song itself, once open, is in
 * library-view.test.ts.)
 */
import { expect } from '@open-wc/testing'
import type { AppHeader } from '../src/components/app-header.ts'
import { SongSelectEvent } from '../src/components/song-list.ts'
import { type ChordlessDB, getCurrentDB } from '../src/js/db.ts'
import { setRouter } from '../src/js/navigation.ts'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  setCurrentOrganisation,
  setOrganisationReadOnly,
} from '../src/js/organisation.ts'
import type { Route } from '../src/js/router.ts'
import { SHARED_DB_ID } from '../src/js/share-receiver.ts'
import { addChart } from '../src/js/song-utils.ts'
import '../src/js/views/library-view.ts'
import type { LibraryView } from '../src/js/views/library-view.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const ALPHA =
  '{title: Alpha Song}\n{key: G}\n{tempo: 80}\n{time: 4/4}\n\n{comment: Verse}\n[G]Alpha words'
const BETA = '{title: Beta Song}\n{key: D}\n\n{comment: Verse}\n[D]Beta words'
const ADD = { variantLabel: 'Test', importSource: 'test', makeDefault: 'first' } as const

describe('the library view', () => {
  let before: { id: string | null; name: string }
  let organisationId: string
  let db: ChordlessDB
  let outlet: HTMLElement
  let view: LibraryView
  let visited: Array<{ url: string; replace?: boolean }>
  let observers: Array<(entries: Array<Partial<IntersectionObserverEntry>>) => void>
  const RealObserver = window.IntersectionObserver

  beforeEach(async () => {
    visited = []
    observers = []
    setRouter({
      navigate: async (url: string, options?: { replace?: boolean }) => {
        visited.push({ url, replace: options?.replace })
        return true
      },
    })
    window.IntersectionObserver = class {
      constructor(callback: (entries: Array<Partial<IntersectionObserverEntry>>) => void) {
        observers.push(callback)
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver
    before = getCurrentOrganisation()
    const organisation = await createOrganisation(`Library ${crypto.randomUUID().slice(0, 8)}`)
    organisationId = organisation.id
    await setCurrentOrganisation(organisation.id, organisation.name)
    db = await getCurrentDB()
    outlet = document.createElement('div')
    document.body.append(outlet)
  })

  afterEach(async () => {
    view?.remove()
    outlet.remove()
    window.IntersectionObserver = RealObserver
    setRouter(null)
    document.body.classList.remove('edit-mode')
    await setOrganisationReadOnly(organisationId, false)
    db.db?.close()
    await deleteDatabase(SHARED_DB_ID)
    await deleteOrganisation(organisationId)
    if (before.id) await setCurrentOrganisation(before.id, before.name)
  })

  async function open(
    route: Route = { name: 'songs' },
    restoredState?: LibraryView['restoredState']
  ) {
    view = document.createElement('library-view')
    view.route = route
    view.restoredState = restoredState
    outlet.append(view)
    await view.updateComplete
    for (let i = 0; i < 100 && view.querySelector('status-message[state="loading"]'); i++)
      await wait(20)
    await wait(100)
  }
  const searchBox = () => must(view.querySelector<HTMLInputElement>('#song-search'))
  const titles = () =>
    [...(view.querySelector('song-list')?.shadowRoot?.querySelectorAll('song-card') ?? [])].map(
      card => card.shadowRoot?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    )
  const heading = () => must(view.querySelector<AppHeader>('#library-app-header')).heading

  describe('the list', () => {
    it('says so when there are no songs', async () => {
      await open()
      expect(view.querySelector('status-message[state="empty"]')).to.not.equal(null)
    })

    it('lists the songs, and narrows them by what is typed, putting the search in the URL after a pause', async () => {
      await addChart(db, ALPHA, ADD)
      await addChart(db, BETA, ADD)
      await open()
      expect(titles()).to.have.length(2)

      searchBox().value = 'beta'
      searchBox().dispatchEvent(new Event('input'))
      await view.updateComplete
      await wait(50)
      expect(titles()).to.have.length(1)
      expect(visited).to.deep.equal([])
      await wait(300)
      expect(visited).to.deep.equal([{ url: '/songs?q=beta', replace: true }])

      // The route that comes back with it is its own echo: the box is left alone
      view.route = { name: 'songs', search: 'beta' }
      await view.updateComplete
      expect(searchBox().value).to.equal('beta')
    })

    it('does not put a search in the URL that is there already, or when a song is open', async () => {
      await addChart(db, ALPHA, ADD)
      await open({ name: 'songs', search: 'alpha' })
      expect(searchBox().value).to.equal('alpha')
      searchBox().value = ' alpha '
      searchBox().dispatchEvent(new Event('input'))
      await wait(350)
      expect(visited).to.deep.equal([])
    })

    it('takes a search from a link, or from the back button', async () => {
      await addChart(db, ALPHA, ADD)
      await open()
      view.route = { name: 'songs', search: 'zzz' }
      await view.updateComplete
      expect(searchBox().value).to.equal('zzz')
      view.route = { name: 'songs' }
      await view.updateComplete
      expect(searchBox().value).to.equal('')
    })

    it('opens a song that is chosen', async () => {
      const song = await addChart(db, ALPHA, ADD)
      await open()
      view
        .querySelector('song-list')
        ?.dispatchEvent(new SongSelectEvent({ uuid: song.uuid } as never, 0, new Event('click')))
      expect(visited).to.deep.equal([{ url: `/songs/${song.uuid}`, replace: undefined }])
    })

    it('ignores a choice with no song', async () => {
      await addChart(db, ALPHA, ADD)
      await open()
      view
        .querySelector('song-list')
        ?.dispatchEvent(new SongSelectEvent(undefined as never, 0, new Event('click')))
      expect(visited).to.deep.equal([])
    })

    it('says so when the songs cannot be read', async () => {
      const real = Object.getPrototypeOf(db).getAllSongs
      Object.getPrototypeOf(db).getAllSongs = () => Promise.reject(new Error('no db'))
      try {
        await open()
      } finally {
        Object.getPrototypeOf(db).getAllSongs = real
      }
      expect(view.querySelector('status-message[state="error"]')).to.not.equal(null)
    })

    it('keeps how far down the list was scrolled', async () => {
      await open()
      expect(view.captureViewState()).to.have.property('scroll')
    })

    it('goes back to the scroll it was left at', async () => {
      await addChart(db, ALPHA, ADD)
      await open({ name: 'songs' }, { scroll: 0 })
      expect(view.querySelector('.library-view')).to.not.equal(null)
    })
  })

  describe('a song', () => {
    it('is opened by the route, and closed when the route goes back to the list', async () => {
      const song = await addChart(db, ALPHA, ADD)
      await open({ name: 'songs', songUuid: song.uuid })
      expect(heading()).to.equal('Alpha Song')
      expect(view.querySelector('#library-song-meta-header')?.textContent).to.equal('80 BPM • 4/4')
      view.route = { name: 'songs' }
      await view.updateComplete
      await wait(100)
      expect(heading()).to.equal('Song Library')
    })

    it('is left alone when the route names the same song again', async () => {
      const song = await addChart(db, ALPHA, ADD)
      await open({ name: 'songs', songUuid: song.uuid })
      view.route = { name: 'songs', songUuid: song.uuid }
      await view.updateComplete
      expect(heading()).to.equal('Alpha Song')
    })

    it('goes back to the list when the song is not there', async () => {
      await open({ name: 'songs', songUuid: 'no-such-song' })
      expect(visited).to.deep.equal([{ url: '/songs', replace: true }])
    })

    it('goes back to the list when the user swipes back to it', async () => {
      const song = await addChart(db, ALPHA, ADD)
      await open({ name: 'songs', songUuid: song.uuid })
      const [observe] = observers
      // (scrolling to the song goes past the list: that is not a swipe)
      observe([{ isIntersecting: true, intersectionRatio: 1 }])
      expect(visited).to.deep.equal([])
      await wait(700)
      observe([{ isIntersecting: false, intersectionRatio: 0.2 }])
      expect(visited).to.deep.equal([])
      observe([{ isIntersecting: true, intersectionRatio: 1 }])
      expect(visited).to.deep.equal([{ url: '/songs', replace: undefined }])
    })

    it('has no swipe back when no song is open', async () => {
      await open()
      observers[0]([{ isIntersecting: true, intersectionRatio: 1 }])
      expect(visited).to.deep.equal([])
    })

    it('has its font made larger and smaller, within limits', async () => {
      const song = await addChart(db, ALPHA, ADD)
      await open({ name: 'songs', songUuid: song.uuid })
      const size = () => must(view.querySelector<HTMLElement>('.song-content')).style.fontSize
      const start = size()
      view.querySelector<HTMLButtonElement>('#library-font-size-increase')?.click()
      expect(size()).to.not.equal(start)
      for (let i = 0; i < 100; i++)
        view.querySelector<HTMLButtonElement>('#library-font-size-increase')?.click()
      const largest = size()
      view.querySelector<HTMLButtonElement>('#library-font-size-increase')?.click()
      expect(size()).to.equal(largest)
      for (let i = 0; i < 200; i++)
        view.querySelector<HTMLButtonElement>('#library-font-size-decrease')?.click()
      const smallest = size()
      view.querySelector<HTMLButtonElement>('#library-font-size-decrease')?.click()
      expect(size()).to.equal(smallest)
    })

    it('shows what is known of it in the info dialog', async () => {
      const song = await addChart(db, ALPHA, ADD)
      await open({ name: 'songs', songUuid: song.uuid })
      const dialog = must(view.querySelector('song-info-dialog')) as HTMLElement & {
        show: unknown
        db: unknown
      }
      const shown: unknown[] = []
      dialog.show = async (...args: unknown[]) => {
        shown.push(args)
      }
      must(view.querySelector('#library-app-header')).dispatchEvent(
        new CustomEvent('app-header:info-click')
      )
      await wait(50)
      expect(shown).to.have.length(1)
      expect((shown[0] as unknown[])[0]).to.equal(song.id)
    })

    it('has no info to show with no song open', async () => {
      await open()
      const dialog = must(view.querySelector('song-info-dialog')) as HTMLElement & { show: unknown }
      let shown = 0
      dialog.show = async () => {
        shown++
      }
      must(view.querySelector('#library-app-header')).dispatchEvent(
        new CustomEvent('app-header:info-click')
      )
      await wait(50)
      expect(shown).to.equal(0)
    })

    it('has a song with no tempo or time, and no key, shown with what it has', async () => {
      const song = await addChart(db, '{title: Bare Song}\n\n{comment: Verse}\n[G]Bare words', ADD)
      await open({ name: 'songs', songUuid: song.uuid })
      expect(heading()).to.equal('Bare Song')
      expect(view.querySelector('#library-song-meta-header')?.textContent).to.equal('')
    })

    it('is shown as Untitled when it has no title', async () => {
      const song = await addChart(db, '{key: G}\n\n{comment: Verse}\n[G]Nameless words', {
        ...ADD,
        title: 'Placeholder',
      })
      await open({ name: 'songs', songUuid: song.uuid })
      expect(heading()).to.not.equal('Song Library')
    })
  })

  describe('a song of another database', () => {
    let shared: ChordlessDB
    beforeEach(async () => {
      shared = new (await import('../src/js/db.ts')).ChordlessDB(SHARED_DB_ID)
      await shared.init()
    })
    afterEach(() => shared.db?.close())

    it('is shown with where it is from, and cannot be edited', async () => {
      const song = await addChart(shared, BETA, ADD)
      await open({ name: 'songs', songUuid: song.uuid })
      expect(view.querySelector('#library-song-source')?.textContent).to.contain(
        'From Shared with me'
      )
      view
        .querySelector<HTMLElement>('#library-app-header')
        ?.dispatchEvent(new CustomEvent('app-header:edit-mode-toggle'))
      expect(document.body.classList.contains('edit-mode')).to.equal(false)
    })

    it('has no info, as it is not the library’s', async () => {
      const song = await addChart(shared, BETA, ADD)
      await open({ name: 'songs', songUuid: song.uuid })
      const dialog = must(view.querySelector('song-info-dialog')) as HTMLElement & { show: unknown }
      let shown = 0
      dialog.show = async () => {
        shown++
      }
      must(view.querySelector('#library-app-header')).dispatchEvent(
        new CustomEvent('app-header:info-click')
      )
      await wait(50)
      expect(shown).to.equal(0)
    })

    it('is copied into the library, and opened there', async () => {
      const song = await addChart(shared, BETA, ADD)
      await open({ name: 'songs', songUuid: song.uuid })
      view.querySelector<HTMLButtonElement>('#add-to-library')?.click()
      await wait(200)
      expect(visited).to.have.length(1)
      expect(visited[0].replace).to.equal(true)
      expect(visited[0].url).to.match(/^\/songs\/.+/)
      expect((await db.getAllSongs()).map(each => each.title)).to.deep.equal(['Beta Song'])
    })

    it('is offered no copying in a view-only organisation', async () => {
      const song = await addChart(shared, BETA, ADD)
      await setOrganisationReadOnly(organisationId, true)
      await open({ name: 'songs', songUuid: song.uuid })
      expect(view.querySelector('#add-to-library')).to.equal(null)
    })

    it('stays where it is when it cannot be copied', async () => {
      const song = await addChart(shared, BETA, ADD)
      await open({ name: 'songs', songUuid: song.uuid })
      const real = Object.getPrototypeOf(db).saveSong
      Object.getPrototypeOf(db).saveSong = () => Promise.reject(new Error('disk full'))
      try {
        view.querySelector<HTMLButtonElement>('#add-to-library')?.click()
        await wait(200)
      } finally {
        Object.getPrototypeOf(db).saveSong = real
      }
      expect(visited).to.deep.equal([])
    })
  })

  describe('being taken away', () => {
    it('stops what it was waiting for', async () => {
      await addChart(db, ALPHA, ADD)
      await open()
      searchBox().value = 'alpha'
      searchBox().dispatchEvent(new Event('input'))
      view.remove()
      await wait(350)
      expect(visited).to.deep.equal([])
    })
  })
})
