/**
 * The library view's list and its way in and out of a song: searching, opening, closing, the
 * song of another database, and the small controls. (The song itself, once open, is in
 * library-view.test.ts.)
 */
import { expect, waitUntil } from '@open-wc/testing'
import type { LitElement } from 'lit'
import type { AppHeader } from '../src/components/app-header.ts'
import { SongSelectEvent } from '../src/components/song-list.ts'
import { SongVersionsChangedEvent } from '../src/components/song-versions.ts'
import { ChordlessDB, getCurrentDB } from '../src/js/db.ts'
import { setRouter } from '../src/js/navigation.ts'
import type { Route } from '../src/js/router.ts'
import { SHARED_DB_ID } from '../src/js/share-receiver.ts'
import { addChart } from '../src/js/song-utils.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  setCurrentSpace,
  setSpaceReadOnly,
} from '../src/js/space.ts'
import { LibraryView } from '../src/js/views/library-view.ts'
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
  let spaceId: string
  let db: ChordlessDB
  let outlet: HTMLElement
  let view: LibraryView
  let visited: Array<{ url: string; replace?: boolean }>
  // The pause before a search goes in the URL, shortened: a wait for nothing to happen is a few
  const realPause = LibraryView.searchPauseMs
  const PAUSE = 20
  const pastPause = () => wait(PAUSE * 4)

  beforeEach(async () => {
    LibraryView.searchPauseMs = PAUSE
    visited = []
    setRouter({
      navigate: async (url: string, options?: { replace?: boolean }) => {
        visited.push({ url, replace: options?.replace })
        return true
      },
    })
    before = getCurrentSpace()
    const space = await createSpace(`Library ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    await setCurrentSpace(space.id, space.name)
    db = await getCurrentDB()
    outlet = document.createElement('div')
    document.body.append(outlet)
  })

  afterEach(async () => {
    LibraryView.searchPauseMs = realPause
    view?.remove()
    outlet.remove()
    setRouter(null)
    document.body.classList.remove('edit-mode')
    await setSpaceReadOnly(spaceId, false)
    db.db?.close()
    await deleteDatabase(SHARED_DB_ID)
    await deleteSpace(spaceId)
    if (before.id) await setCurrentSpace(before.id, before.name)
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
    // The list (or why there is none), and the song if one is asked for, or the move away from it
    const shown = () =>
      visited.length > 0 ||
      (view.querySelector('song-list, status-message:not([state="loading"])') &&
        (!('songUuid' in route && route.songUuid) || view.querySelector('.song-content')))
    await waitUntil(shown, 'the library shows what it was asked for', { timeout: 5000 })
    await (view.querySelector('song-list') as LitElement | null)?.updateComplete
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
      await waitUntil(() => titles().length === 1, 'the list narrows')
      expect(visited).to.deep.equal([])
      await waitUntil(() => visited.length > 0, 'the search goes in the URL')
      expect(visited).to.deep.equal([{ url: '/songs?q=beta', replace: true }])

      // The route that comes back with it is its own echo: the box is left alone
      view.route = { name: 'songs', search: 'beta' }
      await view.updateComplete
      expect(searchBox().value).to.equal('beta')
    })

    it('lists a card for each variant of a song, with its name, and finds one by its name', async () => {
      await addChart(db, ALPHA, ADD)
      await addChart(db, ALPHA.replace('[G]Alpha words', '[A]Alpha words'), {
        ...ADD,
        variantLabel: 'Capo 2',
      })
      await open()
      expect(titles()).to.have.length(2)
      expect(titles().filter(card => card.includes('Alpha Song'))).to.have.length(2)
      expect(titles().some(card => card.includes('Capo 2'))).to.equal(true)
      expect(titles().some(card => card.includes('Test'))).to.equal(true)

      searchBox().value = 'capo'
      searchBox().dispatchEvent(new Event('input'))
      await view.updateComplete
      await waitUntil(() => titles().length === 1, 'the list narrows')
      expect(titles()[0]).to.contain('Capo 2')
    })

    it('looks again when the versions of a song change, and goes back to the list when the song is gone', async () => {
      await addChart(db, ALPHA, ADD)
      await open()
      expect(titles()).to.have.length(1)
      await addChart(db, BETA, ADD)
      const dialog = must(view.querySelector('song-info-dialog'))
      dialog.dispatchEvent(new SongVersionsChangedEvent())
      await waitUntil(() => titles().length === 2, 'it looks again')
      expect(visited).to.deep.equal([])

      dialog.dispatchEvent(new SongVersionsChangedEvent(true))
      await waitUntil(() => visited.length > 0, 'it goes back to the list')
      expect(visited).to.deep.equal([{ url: '/songs', replace: true }])
    })

    it('shows the songs a sync saved, and keeps what was typed in the search', async () => {
      await addChart(db, ALPHA, ADD)
      await open()
      searchBox().value = 'song'
      searchBox().dispatchEvent(new Event('input'))
      await view.updateComplete
      expect(titles()).to.have.length(1)

      // (a sync’s own handle on the database: the write is announced as the sync’s)
      const sync = new ChordlessDB(db.dbName, 'sync')
      await sync.init()
      await addChart(sync, BETA, ADD)
      sync.db?.close()
      await waitUntil(() => titles().length === 2, 'the list shows what the sync saved')

      expect(searchBox().value).to.equal('song')
    })

    it('does not put a search in the URL that is there already, or when a song is open', async () => {
      await addChart(db, ALPHA, ADD)
      await open({ name: 'songs', search: 'alpha' })
      expect(searchBox().value).to.equal('alpha')
      searchBox().value = ' alpha '
      searchBox().dispatchEvent(new Event('input'))
      await pastPause()
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
      await waitUntil(() => heading() === 'Song Library', 'the song is closed')
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

    /** The scroll container, at rest `left` pixels along (the song is one 400px page to the right) */
    const comeToRest = (left: number) => {
      const container = must(view.querySelector('#songs-content-container'))
      Object.defineProperty(container, 'scrollLeft', { value: left, configurable: true })
      Object.defineProperty(container, 'clientWidth', { value: 400, configurable: true })
      container.dispatchEvent(new Event('scrollend'))
    }

    it('goes back to the list when the user swipes back to it', async () => {
      const song = await addChart(db, ALPHA, ADD)
      await open({ name: 'songs', songUuid: song.uuid })
      // (scrolling to the song ends on the song: that is not a swipe)
      comeToRest(400)
      expect(visited).to.deep.equal([])
      comeToRest(0)
      expect(visited).to.deep.equal([{ url: '/songs', replace: undefined }])
    })

    it('has no swipe back when no song is open', async () => {
      await open()
      comeToRest(0)
      expect(visited).to.deep.equal([])
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
      expect(heading()).to.equal('Untitled')
    })

    it('goes back to the list when its chart has nothing in it', async () => {
      const song = await addChart(db, ALPHA, ADD)
      await db.saveChordPro({
        id: song.chordproFileId,
        content: '',
        contentHash: 'empty',
        lastModified: Date.now(),
      })
      await open({ name: 'songs', songUuid: song.uuid })
      expect(visited).to.deep.equal([{ url: '/songs', replace: true }])
    })

    it('is not shown when the route moves on while it is being found', async () => {
      const song = await addChart(db, ALPHA, ADD)
      await open()
      view.route = { name: 'songs', songUuid: song.uuid }
      await view.updateComplete
      view.route = { name: 'songs' }
      await view.updateComplete
      await wait(200)
      expect(heading()).to.equal('Song Library')
      expect(visited).to.deep.equal([])
    })
  })

  describe('the spaces filter', () => {
    let shared: ChordlessDB
    const KEY = 'library-places-left-out'
    beforeEach(async () => {
      localStorage.removeItem(KEY)
      shared = new (await import('../src/js/db.ts')).ChordlessDB(SHARED_DB_ID)
      await shared.init()
    })
    afterEach(() => {
      shared.db?.close()
      localStorage.removeItem(KEY)
    })
    const bar = () => view.querySelector('library-space-filter')
    const chip = (id: string) =>
      must(bar()?.shadowRoot?.querySelector<HTMLButtonElement>(`[data-place="${id}"]`))

    it('is not there when the songs are all from one place', async () => {
      await addChart(db, ALPHA, ADD)
      await open()
      expect(bar()?.shadowRoot?.querySelector('button')).to.equal(null)
    })

    it('starts with every place on, and leaves out the songs of one switched off', async () => {
      await addChart(db, ALPHA, ADD)
      await addChart(shared, BETA, ADD)
      await open()
      expect(titles()).to.have.length(2)
      expect(chip(SHARED_DB_ID).getAttribute('aria-pressed')).to.equal('true')

      chip(SHARED_DB_ID).click()
      await view.updateComplete
      await wait(50)
      expect(chip(SHARED_DB_ID).getAttribute('aria-pressed')).to.equal('false')
      expect(titles()).to.have.length(1)
      expect(titles()[0]).to.contain('Alpha Song')

      chip(SHARED_DB_ID).click()
      await view.updateComplete
      await wait(50)
      expect(titles()).to.have.length(2)
      expect(localStorage.getItem(KEY)).to.equal(null)
    })

    it('is remembered for the next time the library is opened', async () => {
      await addChart(db, ALPHA, ADD)
      await addChart(shared, BETA, ADD)
      await open()
      chip(SHARED_DB_ID).click()
      await view.updateComplete
      expect(JSON.parse(localStorage.getItem(KEY) as string)).to.deep.equal([SHARED_DB_ID])
      view.remove()
      await open()
      expect(titles()).to.have.length(1)
      expect(chip(SHARED_DB_ID).getAttribute('aria-pressed')).to.equal('false')
    })

    it('says no songs match when every place is off, and still searches the rest', async () => {
      await addChart(db, ALPHA, ADD)
      await addChart(shared, BETA, ADD)
      await open()
      chip(spaceId).click()
      await view.updateComplete
      await wait(50)
      expect(titles()).to.have.length(1)
      expect(titles()[0]).to.contain('Beta Song')
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
      await waitUntil(() => visited.length > 0, 'the copy is opened')
      expect(visited).to.have.length(1)
      expect(visited[0].replace).to.equal(true)
      expect(visited[0].url).to.match(/^\/songs\/.+/)
      expect((await db.getAllSongs()).map(each => each.title)).to.deep.equal(['Beta Song'])
    })

    it('is still offered copying in a view-only space', async () => {
      const song = await addChart(shared, BETA, ADD)
      await setSpaceReadOnly(spaceId, true)
      await open({ name: 'songs', songUuid: song.uuid })
      expect(view.querySelector('#add-to-library')).to.not.equal(null)
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
      await pastPause()
      expect(visited).to.deep.equal([])
    })
  })
})
