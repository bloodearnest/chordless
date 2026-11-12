/**
 * The setlist page's header and the ways about it: the overview, the songs, edit mode, the info
 * dialogs, sharing, the menu and the keyboard. (Reordering, adding and removing songs are in
 * setlist-page.test.ts; sections, keys and tempo in setlist-page-songs.test.ts.)
 */
import { expect, waitUntil } from '@open-wc/testing'
import type { AppHeader } from '../src/components/app-header.ts'
import { EditModeToggleEvent, HeaderInfoClickEvent } from '../src/components/app-header.ts'
import type { AppModal } from '../src/components/app-modal.ts'
import type { KeySelector } from '../src/components/key-selector.ts'
import {
  MenuOverviewClickEvent,
  MenuSongClickEvent,
  type NavMenu,
} from '../src/components/nav-menu.ts'
import { SetlistDetailsIdentifyEvent } from '../src/components/setlist-details-form.ts'
import { SetlistRevertedEvent } from '../src/components/setlist-differs.ts'
import {
  SetlistInfoDeleteEvent,
  type SetlistInfoDialog,
  SetlistInfoMoveEvent,
  SetlistInfoSaveEvent,
} from '../src/components/setlist-info-dialog.ts'
import {
  OverviewAddSongEvent,
  OverviewSongBpmChangeEvent,
  OverviewSongClickEvent,
  OverviewSongDeleteEvent,
  OverviewSongKeyChangeEvent,
} from '../src/components/setlist-overview.ts'
import { SetlistShareChangeEvent } from '../src/components/setlist-share.ts'
import { type SongInfoDialog, SongRangeChangedEvent } from '../src/components/song-info-dialog.ts'
import { SongChangeEvent } from '../src/js/app-events.ts'
import type { Person, Setlist } from '../src/js/data-types.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { setCapoPreference } from '../src/js/preferences.ts'
import { writeMusicXml } from '../src/js/score-musicxml.ts'
import { scoreRecord } from '../src/js/score-record.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  setSpaceReadOnly,
  updateSpace,
} from '../src/js/space.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { measure, melodyOf } from './score-build.ts'
import { sampleRecord } from './score-sample.ts'
import { must, useSetlistPage } from './setlist-page-harness.ts'
import { nextTimestamp, nothingFor, shownToast } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

describe('the setlist page: header, menu and keys', () => {
  const rig = useSetlistPage()
  const { $, $$ } = rig

  afterEach(async () => {
    const { id } = getCurrentSpace()
    if (id) await setSpaceReadOnly(id, false)
    document.getElementById('nav-menu')?.remove()
  })

  const header = () => must($<AppHeader>('#app-header'))
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    document.dispatchEvent(event)
    return event
  }
  const urls = () => rig.visited.map(visit => visit.url)

  describe('the overview', () => {
    it('opens a song that is chosen, asks before deleting one, and opens the add dialog', async () => {
      await rig.open()
      const overview = must(rig.page.overview.component)
      overview.dispatchEvent(new OverviewSongClickEvent(1))
      expect(urls().at(-1)).to.match(/\/song\/1$/)

      let asked = 0
      const modal = must($<AppModal>('#delete-song-modal'))
      modal.ask = async () => {
        asked++
        return false
      }
      overview.dispatchEvent(new OverviewSongDeleteEvent(0))
      await waitUntil(() => asked === 1)
      expect(asked).to.equal(1)
      expect($('#delete-song-title')?.textContent).to.equal('Alpha')
      overview.dispatchEvent(new OverviewSongDeleteEvent(99))
      expect(asked).to.equal(1)

      let opened = 0
      rig.page._addSongModal.open = async () => {
        opened++
      }
      overview.dispatchEvent(new OverviewAddSongEvent())
      expect(opened).to.equal(1)
    })

    it('changes the key of a song when told to', async () => {
      const setlist = await rig.open()
      must(rig.page.overview.component).dispatchEvent(new OverviewSongKeyChangeEvent(0, 'A'))
      await waitUntil(async () => must(await rig.db.getSetlist(setlist.id)).songs[0].key === 'A')
      expect(must(await rig.db.getSetlist(setlist.id)).songs[0].key).to.equal('A')
      must(rig.page.overview.component).dispatchEvent(new OverviewSongKeyChangeEvent(0, ''))
    })

    it('changes the tempo of a song when told to', async () => {
      const setlist = await rig.open()
      must(rig.page.overview.component).dispatchEvent(new OverviewSongBpmChangeEvent(0, 88))
      await waitUntil(async () => must(await rig.db.getSetlist(setlist.id)).songs[0].tempo === 88)
      expect(must(await rig.db.getSetlist(setlist.id)).songs[0].tempo).to.equal(88)
    })

    it('removes the listeners from a component it replaces', async () => {
      await rig.open()
      const first = must(rig.page.overview.component)
      await rig.page.renderSetlist(rig.page.currentSetlistId as string)
      expect(rig.page.overview.component).to.not.equal(first)
      const before = rig.visited.length
      first.dispatchEvent(new OverviewSongClickEvent(0))
      expect(rig.visited.length).to.equal(before)
    })

    it('shows an empty setlist, with the header ready, and goes to it from a song that is not there', async () => {
      await rig.open(0, {}, { songIndex: 2 })
      expect(rig.page.songs).to.have.length(0)
      expect(rig.visited.at(-1)).to.deep.equal({
        url: `/setlist/${rig.page.currentSetlistId}`,
        replace: true,
      })
      expect(header().heading).to.not.equal('Loading...')
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    it('has no session to report when there is no such setlist', async () => {
      const { SetlistPage } = await import('../src/js/setlist-page.ts')
      const { baselineAttributes } = await import('../src/js/telemetry/baseline.ts')
      rig.page = new SetlistPage({ root: rig.root, setlistId: 'no-such', db: rig.db })
      await rig.page.start()
      expect(baselineAttributes()).to.not.have.property('session.id')
    })

    it('says so when there is no such setlist, or it cannot be read', async () => {
      const { SetlistPage } = await import('../src/js/setlist-page.ts')
      rig.page = new SetlistPage({ root: rig.root, setlistId: 'no-such', db: rig.db })
      await rig.page.renderSetlist('no-such')
      const message = () =>
        ($('.song-container status-message') as unknown as { message: string }).message
      expect(message()).to.equal('Setlist not found.')
      const real = Object.getPrototypeOf(rig.db).getSetlist
      Object.getPrototypeOf(rig.db).getSetlist = () => Promise.reject(new Error('unreadable'))
      try {
        await rig.page.renderSetlist('whatever')
      } finally {
        Object.getPrototypeOf(rig.db).getSetlist = real
      }
      expect(message()).to.contain('Error loading songs')
    })

    it('starts straight on the song the route names', async () => {
      await rig.open(3, {}, { songIndex: 1 })
      expect(rig.page.currentSongIndex).to.equal(1)
      expect(header().heading).to.equal('Bravo')
      expect(SongChangeEvent.latest?.song?.title).to.equal('Bravo')
    })

    it('goes to the overview when the route names a song that is not there', async () => {
      await rig.open(2, {}, { songIndex: 9 })
      expect(rig.page.currentSongIndex).to.equal(-1)
      expect(rig.visited.at(-1)?.replace).to.equal(true)
    })

    it('has no container to say anything in, and says what is wrong', async () => {
      await rig.open()
      const { SetlistPage } = await import('../src/js/setlist-page.ts')
      const bare = new SetlistPage({
        root: document.createElement('div'),
        setlistId: 'x',
        db: rig.db,
      })
      expect(() => bare._songContainer()).to.throw('no song container')
      expect(() => new SetlistPage({ root: rig.root, setlistId: 'x' })._database()).to.throw(
        'not been started'
      )
    })
  })

  describe('which song is shown', () => {
    it('follows the route, unless it is shown already', async () => {
      await rig.open()
      rig.page.routeChanged({ songIndex: 2 })
      expect(rig.page.currentSongIndex).to.equal(2)
      rig.page.routeChanged({ songIndex: 2 })
      rig.page.routeChanged({ songIndex: -1 })
      expect(rig.page.currentSongIndex).to.equal(-1)
      rig.page.routeChanged({ songIndex: 99 })
      expect(rig.page.currentSongIndex).to.equal(-1)
    })

    it('shows where the route is by the time the setlist has loaded, not where it was', async () => {
      const setlist = await rig.open()
      rig.page.dispose()
      const { SetlistPage } = await import('../src/js/setlist-page.ts')
      rig.page = new SetlistPage({
        root: rig.root,
        setlistId: setlist.id,
        db: rig.db,
        songIndex: 1,
      })
      // (back, back: the route moves on to the overview while the setlist is loading)
      const started = rig.page.start()
      rig.page.routeChanged({ songIndex: -1 })
      await started
      expect(rig.page.currentSongIndex).to.equal(-1)
      // ...and from then on the page follows it
      rig.page.routeChanged({ songIndex: 2 })
      expect(rig.page.currentSongIndex).to.equal(2)
    })

    it('shows nothing, and goes nowhere, when the page is left while its setlist loads', async () => {
      const setlist = await rig.open()
      rig.page.dispose()
      const { SetlistPage } = await import('../src/js/setlist-page.ts')
      rig.page = new SetlistPage({
        root: rig.root,
        setlistId: setlist.id,
        db: rig.db,
        songIndex: 0,
      })
      rig.visited = []
      const started = rig.page.start()
      rig.page.dispose()
      await started
      await rig.flush()
      await rig.flush()
      expect(rig.page.songs).to.have.length(0)
      expect(rig.visited).to.deep.equal([])
    })

    it('ignores the route before a setlist is shown, or once it is gone', async () => {
      await rig.open()
      rig.page.dispose()
      rig.page.routeChanged({ songIndex: 1 })
      expect(rig.page.currentSongIndex).to.not.equal(1)
    })

    it('keeps how far each section was scrolled, and puts it back once', async () => {
      await rig.open()
      expect(rig.page.captureViewState()).to.equal(undefined)
      const section = must($<HTMLElement>('#song-0'))
      section.style.overflow = 'auto'
      section.style.height = '20px'
      must(section.querySelector<HTMLElement>('.song-content')).style.height = '2000px'
      section.scrollTop = 50
      expect(rig.page.captureViewState()?.scrolls?.['song-0']).to.equal(section.scrollTop)
      localStorage.setItem('scroll_to_top_on_swipe', 'false')
      try {
        rig.page._restoredState = { scrolls: { 'song-0': 30, 'song-9': 5 } }
        rig.page._restoreScrolls()
        expect(section.scrollTop).to.equal(30)
        expect(rig.page._restoredState).to.equal(undefined)
      } finally {
        localStorage.removeItem('scroll_to_top_on_swipe')
      }
    })

    describe('starting songs at the top', () => {
      /** Song 0 and 1, tall enough to scroll, with song 0 scrolled and shown */
      async function scrolledSong() {
        await rig.open()
        const first = must($<HTMLElement>('#song-0'))
        first.style.overflow = 'auto'
        first.style.height = '20px'
        must(first.querySelector<HTMLElement>('.song-content')).style.height = '2000px'
        rig.page.showSong(0, true)
        first.scrollTop = 50
        return first
      }
      afterEach(() => localStorage.removeItem('scroll_to_top_on_swipe'))

      it('puts a song back to its top once it is left', async () => {
        const first = await scrolledSong()
        rig.page.showSong(1, true)
        expect(first.scrollTop).to.equal(50) // (not while it may still be sliding away)
        await new Promise(resolve => setTimeout(resolve, 800))
        expect(first.scrollTop).to.equal(0)
      })

      it('leaves it where it was if the user has turned that off', async () => {
        localStorage.setItem('scroll_to_top_on_swipe', 'false')
        const first = await scrolledSong()
        rig.page.showSong(1, true)
        await new Promise(resolve => setTimeout(resolve, 800))
        expect(first.scrollTop).to.equal(50)
      })

      it('does not move a song the user has come back to', async () => {
        const first = await scrolledSong()
        rig.page.showSong(1, true)
        rig.page.showSong(0, true)
        await new Promise(resolve => setTimeout(resolve, 800))
        expect(first.scrollTop).to.equal(50)
      })

      it('puts back only the song shown when the page is returned to', async () => {
        const first = await scrolledSong()
        first.scrollTop = 0
        rig.page._restoredState = { scrolls: { 'song-0': 30, 'song-1': 20 } }
        rig.page._lastVisibleSection = 'song-0'
        rig.page._restoreScrolls()
        expect(first.scrollTop).to.equal(30)
      })
    })

    it('tells the media player the song, with this user’s choices for it', async () => {
      await rig.open()
      const seen: Array<string | undefined> = []
      const listener = (event: Event) => seen.push((event as SongChangeEvent).song?.title)
      document.addEventListener(SongChangeEvent.type, listener)
      try {
        rig.page.showSong(1, true)
        rig.page.showOverview(true)
      } finally {
        document.removeEventListener(SongChangeEvent.type, listener)
      }
      expect(seen).to.deep.equal(['Bravo', undefined])
    })

    it('has nothing to show for a song that is not there', async () => {
      await rig.open()
      rig.page.showSong(9, true)
    })

    it('follows a swipe from the overview to a song and back', async () => {
      await rig.open()
      const observer = must(rig.page.sectionObserver) as unknown as { _callback?: unknown }
      void observer
      const callbacks: Array<(entries: unknown[]) => void> = []
      const RealObserver = window.IntersectionObserver
      window.IntersectionObserver = class {
        constructor(callback: (entries: unknown[]) => void) {
          callbacks.push(callback)
        }
        observe() {}
        disconnect() {}
      } as unknown as typeof IntersectionObserver
      try {
        rig.page.setupSectionObserver()
      } finally {
        window.IntersectionObserver = RealObserver
      }
      const [seen] = callbacks
      const visible = (id: string, ratio = 1) => ({
        isIntersecting: true,
        intersectionRatio: ratio,
        target: { id },
      })
      seen([visible('song-1')])
      expect(rig.page.currentSongIndex).to.equal(1)
      expect(urls().at(-1)).to.match(/\/song\/1$/)
      seen([visible('song-1')])
      seen([visible('overview', 0.2)])
      expect(rig.page.currentSongIndex).to.equal(1)
      seen([{ isIntersecting: false, intersectionRatio: 1, target: { id: 'overview' } }])
      seen([visible('song-9')])
      seen([visible('other')])
      seen([visible('overview'), visible('song-2', 0.7)])
      expect(rig.page.currentSongIndex).to.equal(-1)
      seen([visible('song-0')])
      rig.page._isProgrammaticScroll = true
      seen([visible('overview')])
      expect(rig.page.currentSongIndex).to.equal(0)
    })

    it('scrolls to a section, smoothly or at once', async () => {
      await rig.open()
      rig.page.scrollToSection('song-1', 1, true)
      expect(rig.page.currentSongIndex).to.equal(1)
      expect(rig.page._isProgrammaticScroll).to.equal(false)
      rig.page.scrollToSection('song-2', 2)
      expect(rig.page._isProgrammaticScroll).to.equal(true)
      rig.page.scrollToSection('no-such-section', 5)
      expect(rig.page.currentSongIndex).to.equal(2)
    })
  })

  describe('edit mode', () => {
    it('is the overview’s on the overview, which lets songs be moved, and is left by going into a song', async () => {
      await rig.open()
      header().dispatchEvent(new EditModeToggleEvent())
      expect(rig.page.overview.editMode).to.equal(true)
      expect(header().editMode).to.equal(true)
      expect(rig.page.overview.component?.editMode).to.equal(true)
      rig.page.showSong(0, true)
      expect(rig.page.overview.editMode).to.equal(false)
      expect(header().editMode).to.equal(false)
      rig.page.overview.setEditMode(false)
    })

    it('is a song’s own, entered and left, saving the setlist when it is left', async () => {
      const setlist = await rig.open()
      rig.page.showSong(0, true)
      header().dispatchEvent(new EditModeToggleEvent())
      expect(document.body.classList.contains('edit-mode')).to.equal(true)
      expect(
        $('#key-selector') && ($('#key-selector') as unknown as { editMode: boolean }).editMode
      ).to.equal(true)
      await waitUntil(
        () => $$('.normal-mode-control').every(el => el.classList.contains('fade-complete')),
        'the controls to fade'
      )
      const before = must(await rig.db.getSetlist(setlist.id)).modifiedDate
      // (a clock tick, so a save now has a later time)
      await nextTimestamp()
      header().dispatchEvent(new EditModeToggleEvent())
      expect(document.body.classList.contains('edit-mode')).to.equal(false)
      await waitUntil(
        async () => must(await rig.db.getSetlist(setlist.id)).modifiedDate !== before,
        'the setlist to be saved'
      )
    })

    it('lets a user who can only read change a song’s key too', async () => {
      const { id } = getCurrentSpace()
      await setSpaceReadOnly(must(id), true)
      await rig.open()
      rig.page.showSong(0, true)
      header().dispatchEvent(new EditModeToggleEvent())
      expect(($('#key-selector') as unknown as { editMode: boolean }).editMode).to.equal(true)
      header().dispatchEvent(new EditModeToggleEvent())
      // (left as it was: the controls faded back)
      await waitUntil(() =>
        $$('.normal-mode-control').every(el => el.classList.contains('fade-complete'))
      )
    })

    it('has the capo selector editable too when the capo is on', async () => {
      setCapoPreference(true)
      await rig.open()
      rig.page.showSong(0, true)
      header().dispatchEvent(new EditModeToggleEvent())
      expect(($('#capo-selector') as unknown as { editMode: boolean }).editMode).to.equal(true)
      header().dispatchEvent(new EditModeToggleEvent())
      // (left as it was: the controls faded back)
      await waitUntil(() =>
        $$('.normal-mode-control').every(el => el.classList.contains('fade-complete'))
      )
    })

    it('is left with Escape, and a song’s edits are saved by leaving it', async () => {
      await rig.open()
      rig.page.showSong(0, true)
      header().dispatchEvent(new EditModeToggleEvent())
      expect(press('Escape').defaultPrevented).to.equal(true)
      expect(document.body.classList.contains('edit-mode')).to.equal(false)
      await nothingFor(300)
      expect(press('Escape').defaultPrevented).to.equal(false)
    })

    it('is left when the page is, saving the setlist', async () => {
      await rig.open()
      rig.page.showSong(0, true)
      header().dispatchEvent(new EditModeToggleEvent())
      rig.page.dispose()
      expect(document.body.classList.contains('edit-mode')).to.equal(false)
    })

    it('is the same whichever way it is left: exiting with no setlist saves nothing', async () => {
      await rig.open()
      document.body.classList.add('edit-mode')
      rig.page.currentSetlist = undefined
      await rig.page.exitEditMode()
      expect(document.body.classList.contains('edit-mode')).to.equal(false)
    })
  })

  describe('the header', () => {
    it('shows the setlist’s title on the overview, and the song’s on a song', async () => {
      await rig.open(2, { name: 'Harvest' })
      expect(header().heading).to.contain('Harvest')
      await rig.page.header.show(rig.page.songs[0], true)
      expect(header().heading).to.equal('Alpha')
      rig.page.currentSetlist = undefined
      await rig.page.header.show(null, true)
      expect(header().heading).to.equal('Setlist')
    })

    it('changes with a fade when it is not told to be quick, and not at all when nothing changes', async () => {
      await rig.open()
      await rig.page.header.show(rig.page.songs[0], false)
      expect(header().heading).to.equal('Alpha')
      await rig.page.header.show(rig.page.songs[0], false)
      expect(($('.header-controls-slot') as HTMLElement).style.opacity).to.equal('1')
    })

    it('offers the edit toggle on the overview to a user who can only read too', async () => {
      const { id } = getCurrentSpace()
      await setSpaceReadOnly(must(id), true)
      await rig.open()
      expect(header().showEditToggle).to.equal(true)
      await rig.page.header.show(rig.page.songs[0], true)
      expect(header().showEditToggle).to.equal(true)
    })

    it('shows the edit toggle on a setlist that was received by link (it hides chords and sections)', async () => {
      await rig.open(3, {}, { readOnly: true })
      await rig.page.header.show(null, true)
      expect(header().showEditToggle).to.equal(true)
      await rig.page.header.show(rig.page.songs[0], true)
      expect(header().showEditToggle).to.equal(true)
    })

    it('shows a song with no key without a key list', async () => {
      await rig.open()
      rig.page.songs[0].currentKey = undefined
      await rig.page.header.show(rig.page.songs[0], true)
      expect(($('#key-selector') as unknown as { value: string }).value).to.equal('-')
    })

    it('gives the overview a short date and a row under it for the name, or else the type', async () => {
      await rig.open()
      Object.assign(rig.page.currentSetlist ?? {}, {
        date: '2026-10-18',
        name: 'Harvest',
        type: 'Sunday',
      })
      await rig.page.header.show(null, true)
      expect(header().phoneHeading).to.match(/^(18 Oct|Oct 18)/)
      expect(header().subheading).to.equal('Harvest')
      Object.assign(rig.page.currentSetlist ?? {}, { name: '' })
      await rig.page.header.show(null, true)
      expect(header().subheading).to.equal('Sunday')
      Object.assign(rig.page.currentSetlist ?? {}, { type: '' })
      await rig.page.header.show(null, true)
      expect(header().subheading).to.equal('')
      await rig.page.header.show(rig.page.songs[0], true)
      expect(header().phoneHeading).to.equal('')
      expect(header().subheading).to.equal('')
    })

    it('gives the overview a second header with its leader and the type, but not Other, and a song none', async () => {
      await rig.open()
      Object.assign(rig.page.currentSetlist ?? {}, {
        type: 'Church Service',
        received: { fileId: 'f', leaderName: ' Ann ' },
      })
      await rig.page.header.show(null, true)
      expect(header().subheader).to.equal('Ann · Church Service')
      Object.assign(rig.page.currentSetlist ?? {}, { type: 'Other' })
      await rig.page.header.show(null, true)
      expect(header().subheader).to.equal('Ann')
      await rig.page.header.show(rig.page.songs[0], true)
      expect(header().subheader).to.equal('')
    })

    it('names the leader of a setlist of a space in the second header, once the people are read', async () => {
      await rig.open()
      // (the rig's database is shared by the tests: this one does not leave a person in it)
      const real = rig.db.getAllPeople
      rig.db.getAllPeople = async () => [
        { id: 'ann', name: 'Ann', emails: [], modifiedDate: 'then' },
      ]
      try {
        Object.assign(rig.page.currentSetlist ?? {}, { type: 'Event', leaderId: 'ann' })
        await rig.page.header.show(null, true)
        await waitUntil(() => header().subheader === 'Ann · Event', 'the leader is named')
      } finally {
        rig.db.getAllPeople = real
      }
    })

    it('keeps the header out of a scroll on the overview', async () => {
      await rig.open()
      await rig.page.header.show(null, true)
      const section = must($<HTMLElement>('#overview'))
      section.dispatchEvent(new Event('scroll'))
      expect(header().tucked).to.equal(false)
    })

    it('does nothing for a header that is not there', async () => {
      await rig.open()
      rig.root.querySelector('#app-header')?.remove()
      await rig.page.header.show(null, true)
      rig.page.header.showKey('G')
    })
  })

  describe('the share button', () => {
    it('is on the overview only, lit while the setlist is shared, and opens the share dialog', async () => {
      await rig.open(3, {
        share: {
          fileId: 'f',
          key: 'k',
          created: '2026-01-01',
          expires: '2099-01-01',
          bundleHash: 'h',
        },
      })
      const button = must($<HTMLElement>('#share-button'))
      expect(button.hidden).to.equal(false)
      expect(button.classList.contains('shared')).to.equal(true)
      rig.page.showSong(0, true)
      await rig.page.header.show(rig.page.songs[0], true)
      expect(button.hidden).to.equal(true)
      await rig.page.header.show(null, true)
      let shown = 0
      const dialog = must($('#setlist-share')) as unknown as HTMLElement & {
        show(): void
        setlist: unknown
      }
      dialog.show = () => {
        shown++
      }
      button.click()
      expect(shown).to.equal(1)
      expect((dialog.setlist as { id: string }).id).to.equal(rig.page.currentSetlistId)
      dialog.setlist = { ...(rig.page.currentSetlist as object), share: null }
      dialog.dispatchEvent(new SetlistShareChangeEvent())
      expect(button.classList.contains('shared')).to.equal(false)
    })

    it('opens at once, and gives the dialog the leader’s name when it has been read', async () => {
      await rig.open()
      const ann = { id: 'ann', name: 'Ann Smith', emails: [], modifiedDate: 'then' }
      // (the rig's database is shared by the tests: this one does not leave a person in it)
      const real = rig.db.getAllPeople
      rig.db.getAllPeople = async () => [ann]
      try {
        rig.page.currentSetlist = { ...(rig.page.currentSetlist as Setlist), leaderId: 'ann' }
        const dialog = must($('#setlist-share')) as unknown as { show(): void; leader: string }
        let shown = 0
        dialog.show = () => {
          shown++
        }
        must($<HTMLElement>('#share-button')).click()
        expect(shown).to.equal(1)
        await waitUntil(() => dialog.leader === 'Ann Smith', 'the leader’s name')
      } finally {
        rig.db.getAllPeople = real
      }
    })

    it('is not set up again when the setlist is shown again', async () => {
      await rig.open()
      await rig.page.renderSetlist(rig.page.currentSetlistId as string)
      let shown = 0
      const dialog = must($('#setlist-share')) as unknown as { show(): void }
      dialog.show = () => {
        shown++
      }
      must($<HTMLElement>('#share-button')).click()
      expect(shown).to.equal(1)
    })
  })

  describe('the differs-from-official button', () => {
    const changedHere = { fileRef: 'f', syncedContentHash: 'not-this' }

    it('is on the overview of a changed setlist of a user who can only read, and opens its dialog', async () => {
      const { id } = getCurrentSpace()
      await setSpaceReadOnly(must(id), true)
      await rig.open(3, changedHere)
      const button = must($<HTMLElement>('#differs-button'))
      expect(button.hidden).to.equal(false)
      rig.page.showSong(0, true)
      await rig.page.header.show(rig.page.songs[0], true)
      expect(button.hidden).to.equal(true)

      const dialog = must($('#setlist-differs')) as unknown as HTMLElement & {
        show(): void
        setlist: unknown
      }
      let shown = 0
      dialog.show = () => {
        shown++
      }
      button.click()
      expect(shown).to.equal(1)
      expect((dialog.setlist as { id: string }).id).to.equal(rig.page.currentSetlistId)

      const rendered: string[] = []
      rig.page.renderSetlist = async (setlistId: string) => {
        rendered.push(setlistId)
      }
      dialog.dispatchEvent(new SetlistRevertedEvent())
      expect(rendered).to.deep.equal([rig.page.currentSetlistId])
      // (and it is set up once)
      rig.page.header.refreshDiffers()
      button.click()
      expect(shown).to.equal(2)
    })

    it('is not there for a writer, or for a setlist that is as Drive has it', async () => {
      await rig.open(3, changedHere)
      expect(must($<HTMLElement>('#differs-button')).hidden).to.equal(true)
      const { id } = getCurrentSpace()
      await setSpaceReadOnly(must(id), true)
      await rig.open(3, { fileRef: null })
      expect(must($<HTMLElement>('#differs-button')).hidden).to.equal(true)
    })
  })

  describe('the info button', () => {
    it('shows the song’s info on a song, and the setlist’s on the overview', async () => {
      await rig.open()
      const songDialog = must($('#song-info-dialog')) as unknown as {
        show: (...a: unknown[]) => Promise<void>
      }
      const shownSongs: unknown[][] = []
      songDialog.show = async (...args) => {
        shownSongs.push(args)
      }
      const setlistDialog = must($<SetlistInfoDialog>('#setlist-info-dialog'))
      const shownSetlists: unknown[] = []
      setlistDialog.show = async setlist => {
        shownSetlists.push(setlist)
      }
      header().dispatchEvent(new HeaderInfoClickEvent())
      await waitUntil(() => shownSetlists.length === 1)
      expect(shownSetlists).to.have.length(1)
      rig.page.showSong(0, true)
      await rig.page.header.show(rig.page.songs[0], true)
      header().dispatchEvent(new HeaderInfoClickEvent())
      await waitUntil(() => shownSongs.length === 1)
      expect(shownSongs).to.have.length(1)
      expect(shownSongs[0][0]).to.equal(rig.page.songs[0].songId)
    })

    it('gives the key picker the melody range the song info dialog sets, or takes away', async () => {
      await rig.open()
      rig.page.showSong(0, true)
      await rig.page.header.show(rig.page.songs[0], true)
      const dialog = must($<SongInfoDialog>('#song-info-dialog'))
      dialog.show = async () => {}
      await rig.page.showSongInfo(rig.page.songs[0])
      // (asked again: it listens once)
      const handler = rig.page._rangeChangedHandler
      await rig.page.showSongInfo(rig.page.songs[0])
      expect(rig.page._rangeChangedHandler).to.equal(handler)

      const song = rig.page.songs[0]
      const picker = () => must($('#key-selector')) as unknown as KeySelector
      dialog.dispatchEvent(new SongRangeChangedEvent(song.songId, 'D4-E5'))
      expect(song.parsed.metadata.x_chordless_range).to.equal('D4-E5')
      expect(picker().range).to.deep.equal({ low: 62, high: 76 })
      expect(picker().rangeKey).to.equal(song.originalKey)

      dialog.dispatchEvent(new SongRangeChangedEvent(song.songId, null))
      expect(song.parsed.metadata.x_chordless_range).to.equal(undefined)
      expect(picker().range).to.equal(null)

      // (another song's is not this one's)
      dialog.dispatchEvent(new SongRangeChangedEvent('title-another-song', 'D4-E5'))
      expect(picker().range).to.equal(null)
    })

    it('gives the key picker the range of the song’s melody when the chart has none', async () => {
      await rig.open()
      await rig.db.saveScore(sampleRecord(rig.songs[0].uuid, 'G'))
      rig.page.showSong(0, true)
      await rig.page.header.show(rig.page.songs[0], true)
      const picker = must($('#key-selector')) as unknown as KeySelector
      await waitUntil(() => picker.range)
      expect(picker.range).to.deep.equal({ low: 60, high: 67 })
      expect(picker.rangeKey).to.equal('G')
    })

    describe('the melody button', () => {
      const toggle = () =>
        rig.root
          .querySelector<HTMLElement>('app-header')
          ?.shadowRoot?.querySelector<HTMLButtonElement>('.melody-toggle')
      const enabled = () => (toggle()?.disabled === false ? toggle() : null)
      const sheetOf = (index: number) => rig.root.querySelector(`#song-${index} score-view`)
      const lyricsOf = (index: number) =>
        rig.root.querySelector<HTMLElement>(`#song-${index} song-display`)
      const until = (condition: () => unknown) => waitUntil(condition)
      const pressed = () => toggle()?.getAttribute('aria-pressed')

      it('is there for a song with a melody and greyed out for one without', async () => {
        await rig.db.saveScore(sampleRecord(rig.songs[0].uuid, 'G'))
        await rig.open()
        rig.page.showSong(0, true)
        await rig.page.header.show(rig.page.songs[0], true)
        await until(() => enabled())
        rig.page.showSong(1, true)
        await rig.page.header.show(rig.page.songs[1], true)
        await until(() => toggle()?.disabled)
        expect(toggle()?.disabled).to.equal(true)
        await rig.db.deleteScore(rig.songs[0].uuid, { remember: false })
      })

      it('shows the melody sheet in place of the lyrics, for this song alone, and follows the route', async () => {
        await rig.db.saveScore(sampleRecord(rig.songs[0].uuid, 'G'))
        await rig.db.saveScore(sampleRecord(rig.songs[1].uuid, 'G'))
        try {
          await rig.open()
          rig.page.showSong(0, true)
          await rig.page.header.show(rig.page.songs[0], true)
          rig.page.currentSongIndex = 0
          await until(() => enabled())
          toggle()?.click()
          await until(() => sheetOf(0) && pressed() === 'true')
          expect(sheetOf(0)?.hasAttribute('hidden')).to.equal(false)
          expect(lyricsOf(0)?.style.display).to.equal('none')
          expect(rig.visited.at(-1)).to.deep.equal({
            url: `/setlist/${rig.page.currentSetlistId}/song/0?melody`,
            replace: true,
          })
          expect(toggle()?.getAttribute('aria-pressed')).to.equal('true')

          // the next song is in its lyrics, and this one is as it was left
          expect(sheetOf(1)).to.equal(null)
          rig.page.showSong(1, true)
          rig.page.currentSongIndex = 1
          await rig.page.header.show(rig.page.songs[1], true)
          await until(() => pressed() === 'false')
          expect(toggle()?.getAttribute('aria-pressed')).to.equal('false')
          expect(rig.page.navigateTo(1)).to.not.equal(undefined)
          expect(rig.visited.at(-1)?.url).to.not.contain('melody')
          rig.page.navigateTo(0)
          expect(rig.visited.at(-1)?.url).to.contain('/song/0?melody')

          // and back to the lyrics
          rig.page.showSong(0, true)
          rig.page.currentSongIndex = 0
          await rig.page.header.show(rig.page.songs[0], true)
          await until(() => pressed() === 'true')
          toggle()?.click()
          await until(() => sheetOf(0)?.hasAttribute('hidden') && pressed() === 'false')
          expect(sheetOf(0)?.hasAttribute('hidden')).to.equal(true)
          expect(lyricsOf(0)?.style.display).to.equal('')
          expect(rig.visited.at(-1)?.url).to.not.contain('melody')
        } finally {
          await rig.db.deleteScore(rig.songs[0].uuid, { remember: false })
          await rig.db.deleteScore(rig.songs[1].uuid, { remember: false })
        }
      })

      it('keeps the sheet, and never shows the lyrics, while the song is drawn again for a new key', async () => {
        await rig.db.saveScore(sampleRecord(rig.songs[0].uuid, 'G'))
        try {
          await rig.open()
          rig.page.showSong(0, true)
          rig.page.currentSongIndex = 0
          rig.page.routeChanged({ songIndex: 0, melody: true })
          await until(() => sheetOf(0) && lyricsOf(0)?.style.display === 'none')
          const before = sheetOf(0)
          let lyricsSeen = false
          let watching = true
          const watch = () => {
            if (lyricsOf(0)?.style.display !== 'none') lyricsSeen = true
            if (watching) requestAnimationFrame(watch)
          }
          watch()
          await rig.page.reRenderSong(0)
          await new Promise(resolve => requestAnimationFrame(() => resolve(null)))
          watching = false
          expect(sheetOf(0) === before, 'the same sheet').to.equal(true)
          expect(lyricsSeen, 'the lyrics were shown').to.equal(false)
        } finally {
          await rig.db.deleteScore(rig.songs[0].uuid, { remember: false })
        }
      })

      it('gives a part of the chart with no words the notes of the sheet that are its own', async () => {
        // (a bar of cue-size notes in the sheet's INTRO, which the chart's wordless Intro is by name)
        const cue = melodyOf('Alpha', [measure(1, ['C4:4:'], { section: 'INTRO' })])
        for (const e of cue.measures[0].voices[0]) e.cue = true
        await rig.db.saveScore(scoreRecord(rig.songs[0].uuid, writeMusicXml(cue), 'G'))
        const song = await rig.db.getSong(rig.songs[0].uuid)
        await rig.db.saveChordPro({
          id: song?.chordproFileId as string,
          content:
            '{title: Alpha}\n{key: G}\n\n{comment: Intro}\n[G] [C]\n\n{comment: Verse 1}\n[G]Amazing [C]grace',
          contentHash: 'with-intro',
          lastModified: Date.now(),
        })
        try {
          await rig.open()
          rig.page.showSong(0, true)
          const sections = () =>
            Array.from(
              rig.root
                .querySelectorAll('#song-0 song-display')[0]
                ?.shadowRoot?.querySelectorAll('song-section') ?? []
            ) as unknown as { label: string; melodyMeasures: number[] | null }[]
          await until(() => sections().find(s => s.label === 'Intro')?.melodyMeasures)
          expect(sections().find(s => s.label === 'Intro')?.melodyMeasures).to.deep.equal([0])
          // (a part with words is for singing: no staff)
          expect(sections().find(s => s.label === 'Verse 1')?.melodyMeasures).to.equal(null)
        } finally {
          await rig.db.deleteScore(rig.songs[0].uuid, { remember: false })
        }
      })

      it('follows a route that asks for the melody, and for the lyrics again', async () => {
        await rig.db.saveScore(sampleRecord(rig.songs[0].uuid, 'G'))
        try {
          await rig.open()
          rig.page.showSong(0, true)
          rig.page.currentSongIndex = 0
          rig.page.routeChanged({ songIndex: 0, melody: true })
          await until(() => sheetOf(0) && lyricsOf(0)?.style.display === 'none')
          expect(sheetOf(0)).to.not.equal(null)
          expect(lyricsOf(0)?.style.display).to.equal('none')
          rig.page.routeChanged({ songIndex: 0 })
          await until(() => lyricsOf(0)?.style.display === '')
          expect(lyricsOf(0)?.style.display).to.equal('')
          // (another song's mode does not touch the header, which is for the song in view)
          await rig.page.setMelodyMode(1, true)
          expect(toggle()?.getAttribute('aria-pressed')).to.equal('false')
          rig.page.songs[0].currentKey = undefined
          rig.page.routeChanged({ songIndex: 0, melody: true })
          await until(() => sheetOf(0))
          rig.page.routeChanged({ songIndex: 0 })
          // (a song with no melody stays in its lyrics)
          rig.page.routeChanged({ songIndex: 2, melody: true })
          await nothingFor()
          expect(sheetOf(2)).to.equal(null)
          expect(lyricsOf(2)?.style.display).to.equal('')
        } finally {
          await rig.db.deleteScore(rig.songs[0].uuid, { remember: false })
        }
      })
    })

    it('does nothing for an info dialog that is not there', async () => {
      await rig.open()
      rig.root.querySelector('#song-info-dialog')?.remove()
      rig.root.querySelector('#setlist-info-dialog')?.remove()
      await rig.page.showSongInfo(rig.page.songs[0])
      await rig.page.showSetlistInfo()
    })

    it('makes the setlist’s info read-only for a setlist received by link', async () => {
      await rig.open(3, {}, { readOnly: true })
      const dialog = must($<SetlistInfoDialog>('#setlist-info-dialog'))
      dialog.show = async () => {}
      await rig.page.showSetlistInfo()
      expect(dialog.readonly).to.equal(true)
      expect(dialog.people).to.deep.equal([])
    })

    it('lets a writer pick the leader from the people there are, and listens for its save once', async () => {
      await rig.open()
      const dialog = must($<SetlistInfoDialog>('#setlist-info-dialog'))
      dialog.show = async () => {}
      await rig.page.showSetlistInfo()
      await rig.page.showSetlistInfo()
      expect(dialog.readonly).to.equal(false)
      expect(rig.page._setlistDetailsSaveHandler).to.be.a('function')
    })
  })

  describe('which of the people the user is', () => {
    it('is asked in the info dialog when it cannot be told, and the answer is given back to it', async () => {
      await rig.open()
      const auth = installFakeAuthWorker()
      auth.worker.stored = {
        blob: 'blob',
        metadata: {
          access_token: 'token',
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          user: {
            picture: null,
            given_name: null,
            family_name: null,
            sub: '1',
            name: 'Dee Question',
            email: 'dee@home.org',
          },
        },
        updated_at: new Date().toISOString(),
      } as never
      // (the rig's database is shared by the tests: these people are not left in it)
      const people: Person[] = [
        { id: 'dee-at-work', name: 'Dee Question', emails: ['dee@work.org'], modifiedDate: 'then' },
      ]
      const db = rig.db
      const real = { all: db.getAllPeople, one: db.getPerson, save: db.savePeople }
      db.getAllPeople = async () => people.map(each => ({ ...each }))
      db.getPerson = async id => people.find(each => each.id === id)
      db.savePeople = async saved => {
        for (const each of saved) {
          const at = people.findIndex(have => have.id === each.id)
          if (at === -1) people.push(each)
          else people[at] = each
        }
      }
      try {
        const dialog = must($<SetlistInfoDialog>('#setlist-info-dialog'))
        dialog.show = async () => {}
        await rig.page.showSetlistInfo()
        expect(dialog.askWho).to.equal(true)
        expect(dialog.meId).to.equal(null)

        dialog.dispatchEvent(new SetlistDetailsIdentifyEvent('dee-at-work'))
        await waitUntil(() => dialog.askWho === false, 'the answer to be taken')

        expect(dialog.meId).to.equal('dee-at-work')
      } finally {
        db.getAllPeople = real.all
        db.getPerson = real.one
        db.savePeople = real.save
        auth.uninstall()
        localStorage.removeItem(`chordless:me:${db.spaceId}`)
      }
    })
  })

  describe('the setlist’s details', () => {
    const changes = (name: string) => ({
      date: '2099-02-02',
      time: '09:00',
      type: 'Event',
      name,
      leaderId: '',
    })

    it('are saved, and shown in the header, the menu and the dialog', async () => {
      await rig.open()
      const dialog = must($<SetlistInfoDialog>('#setlist-info-dialog'))
      let reshown = 0
      dialog.show = async () => {
        reshown++
      }
      await rig.page.showSetlistInfo()
      dialog.dispatchEvent(
        new SetlistInfoSaveEvent(rig.page.currentSetlistId as string, changes('Renamed'))
      )
      await waitUntil(
        async () =>
          must(await rig.db.getSetlist(rig.page.currentSetlistId as string)).name === 'Renamed' &&
          reshown > 0,
        'the setlist to be saved and shown again'
      )
      expect(must(await rig.db.getSetlist(rig.page.currentSetlistId as string)).name).to.equal(
        'Renamed'
      )
      expect(reshown).to.be.greaterThan(0)
      rig.page.showSong(0, true)
      await rig.page.saveSetlistDetails(changes('Again'))
      expect(header().heading).to.equal('Alpha')
    })

    it('make a person of a leader typed in with Other…, and the dialog shows them', async () => {
      await rig.open()
      const dialog = must($<SetlistInfoDialog>('#setlist-info-dialog'))
      await rig.page.showSetlistInfo()
      await rig.page.saveSetlistDetails({
        ...changes('Visiting'),
        leaderId: '',
        newLeader: 'Visiting Vic',
      })
      const vic = must(dialog.people.find(person => person.name === 'Visiting Vic'))
      expect(must(await rig.db.getSetlist(rig.page.currentSetlistId as string)).leaderId).to.equal(
        vic.id
      )
      expect(dialog.shadowRoot?.querySelector('setlist-info')).to.exist
    })

    it('are left as they were, and said so, when they cannot be saved', async () => {
      await rig.open(3, { name: 'Original' })
      const real = Object.getPrototypeOf(rig.db).updateSetlist
      Object.getPrototypeOf(rig.db).updateSetlist = () => Promise.reject(new Error('disk full'))
      try {
        await rig.page.saveSetlistDetails(changes('Lost'))
      } finally {
        Object.getPrototypeOf(rig.db).updateSetlist = real
      }
      expect(rig.page.currentSetlist?.name).to.equal('Original')
      expect(shownToast()).to.include({ kind: 'error', details: 'disk full' })
      expect(shownToast()?.message).to.contain("Couldn't save the setlist details")
    })

    it('are not saved for a setlist that has gone', async () => {
      const setlist = await rig.open(2, { name: 'Original' })
      await rig.db.deleteSetlist(setlist.id)
      await rig.page.saveSetlistDetails(changes('Lost'))
      expect(shownToast()).to.equal(null)
      expect(await rig.db.getSetlist(setlist.id)).to.equal(undefined)
    })

    it('are not saved with no setlist', async () => {
      await rig.open()
      rig.page.currentSetlist = undefined
      await rig.page.saveSetlistDetails(changes('x'))
    })
  })

  describe('deleting the setlist', () => {
    async function ready() {
      const setlist = await rig.open()
      const dialog = must($<SetlistInfoDialog>('#setlist-info-dialog'))
      dialog.show = async () => {}
      await rig.page.showSetlistInfo()
      return { setlist, dialog }
    }

    it('asks, deletes what is not in Drive, forgets its state, and goes home', async () => {
      const { setlist, dialog } = await ready()
      localStorage.setItem(`state-${setlist.id}`, '{}')
      must($<AppModal>('#delete-setlist-modal')).ask = async () => true
      dialog.dispatchEvent(new SetlistInfoDeleteEvent(setlist.id))
      await waitUntil(
        async () => (await rig.db.getSetlist(setlist.id)) === undefined,
        'the setlist to be deleted'
      )
      expect(localStorage.getItem(`state-${setlist.id}`)).to.equal(null)
      expect(urls().at(-1)).to.equal('/')
    })

    it('does nothing when it is not confirmed', async () => {
      const { setlist } = await ready()
      must($<AppModal>('#delete-setlist-modal')).ask = async () => false
      await rig.page.deleteSetlist()
      expect(await rig.db.getSetlist(setlist.id)).to.not.equal(undefined)
    })

    it('says in the question that a setlist in Drive goes to the Drive trash', async () => {
      const { setlist } = await ready()
      must(rig.page.currentSetlist).fileRef = 'in-drive'
      let seen = ''
      must($<AppModal>('#delete-setlist-modal')).ask = async () => {
        seen = $('#delete-setlist-text')?.textContent ?? ''
        return false
      }
      await rig.page.deleteSetlist()
      expect(seen).to.contain('Google Drive trash')
      expect(await rig.db.getSetlist(setlist.id)).to.not.equal(undefined)
    })

    it('notes the file of one in Drive for the trash, and a toast offers Undo that puts it back as it was', async () => {
      const { setlist } = await ready()
      const inDrive = { ...setlist, fileRef: 'in-drive', name: 'Kept' }
      await rig.db.saveSetlist(inDrive)
      rig.page.currentSetlist = inDrive
      must($<AppModal>('#delete-setlist-modal')).ask = async () => true
      await rig.page.deleteSetlist()

      expect(await rig.db.getSetlist(setlist.id)).to.equal(undefined)
      expect((await rig.db.getPendingDeletions()).map(entry => entry.ref)).to.deep.equal([
        'in-drive',
      ])
      const toast = must(shownToast())
      expect(toast.message).to.contain('Deleted')
      expect(toast.action?.label).to.equal('Undo')

      toast.action?.run()
      await waitUntil(
        async () => (await rig.db.getSetlist(setlist.id)) !== undefined,
        'the setlist to come back'
      )
      const back = must(await rig.db.getSetlist(setlist.id))
      expect([back.name, back.fileRef]).to.deep.equal(['Kept', 'in-drive'])
      expect(await rig.db.getPendingDeletions()).to.deep.equal([])
    })

    it('lets a worship leader of a team delete a setlist they lead', async () => {
      const { setlist, dialog } = await ready()
      const space = getCurrentSpace().id as string
      try {
        await updateSpace(space, { team: { id: 'team-1', role: 'writer' } })
        dialog.people = [{ id: 'ann', name: 'Ann', emails: [], modifiedDate: '' } as Person]
        dialog.meId = 'ann'
        await rig.page._loadDialogActions(dialog, { ...setlist, leaderId: 'ann' })
        expect(dialog.deleteBlocked).to.equal(null)
        await rig.page._loadDialogActions(dialog, { ...setlist, leaderId: 'bea' })
        expect(dialog.deleteBlocked).to.contain('only the leader')
      } finally {
        await updateSpace(space, { team: undefined })
      }
    })

    it('says who may not delete it: a worship leader of a team, for a setlist they do not lead', async () => {
      const { setlist, dialog } = await ready()
      const space = getCurrentSpace().id as string
      try {
        await updateSpace(space, { team: { id: 'team-1', role: 'writer' } })
        await rig.page.showSetlistInfo()
        expect(dialog.deleteBlocked).to.contain('only the leader')

        await updateSpace(space, { team: { id: 'team-1', role: 'admin' } })
        await rig.page.showSetlistInfo()
        expect(dialog.deleteBlocked).to.equal(null)
      } finally {
        await updateSpace(space, { team: undefined })
      }
      expect(await rig.db.getSetlist(setlist.id)).to.not.equal(undefined)
    })

    it('offers the other spaces on this device to move it to, but not a team it cannot write to', async () => {
      const { dialog } = await ready()
      const open = await createSpace(`Events ${crypto.randomUUID().slice(0, 8)}`)
      const readOnly = await createSpace(`Members ${crypto.randomUUID().slice(0, 8)}`)
      try {
        await updateSpace(readOnly.id, { team: { id: 'team-2', role: 'reader' } })
        await rig.page.showSetlistInfo()
        const targets = dialog.moveTargets.map(target => target.id)
        expect(targets).to.include(open.id)
        expect(targets).to.not.include(readOnly.id)
        expect(targets).to.not.include(getCurrentSpace().id)
      } finally {
        await deleteSpace(open.id)
        await deleteSpace(readOnly.id)
      }
    })

    describe('moving it to another space', () => {
      let target: Awaited<ReturnType<typeof createSpace>>
      let destination: ChordlessDB

      beforeEach(async () => {
        target = await createSpace(`Events ${crypto.randomUUID().slice(0, 8)}`)
        destination = new ChordlessDB(target.id)
        await destination.init()
      })

      afterEach(async () => {
        destination.db?.close()
        await deleteSpace(target.id)
      })

      it('asks, adds it there with its leader and charts, removes it here, notes its file, and goes home', async () => {
        const person = { id: 'ann', name: 'Ann Singer', emails: ['ann@example.com'] }
        await rig.db.savePeople([{ ...person, modifiedDate: new Date().toISOString() } as Person])
        const { setlist } = await ready()
        const inDrive = { ...setlist, fileRef: 'in-drive', leaderId: 'ann' }
        await rig.db.saveSetlist(inDrive)
        rig.page.currentSetlist = inDrive
        let seen = ''
        must($<AppModal>('#move-setlist-modal')).ask = async () => {
          seen = $('#move-setlist-text')?.textContent ?? ''
          return true
        }

        await rig.page.moveSetlist(target.id)

        expect(seen).to.contain(target.name)
        expect(seen).to.contain('Google Drive trash')
        expect(await rig.db.getSetlist(setlist.id)).to.equal(undefined)
        expect((await rig.db.getPendingDeletions()).map(entry => entry.ref)).to.deep.equal([
          'in-drive',
        ])
        const there = must(await destination.getSetlist(setlist.id))
        expect(there.fileRef).to.equal(undefined)
        expect((await destination.getAllSongs()).length).to.equal(setlist.songs.length)
        const leader = (await destination.getAllPeople()).find(each => each.id === there.leaderId)
        expect(leader?.name).to.equal('Ann Singer')
        expect(shownToast()?.message).to.contain(`Moved`)
        expect(urls().at(-1)).to.equal('/')
      })

      it('changes nothing when it is not confirmed', async () => {
        const { setlist } = await ready()
        must($<AppModal>('#move-setlist-modal')).ask = async () => false
        await rig.page.moveSetlist(target.id)
        expect(await rig.db.getSetlist(setlist.id)).to.not.equal(undefined)
        expect(await destination.getAllSetlists()).to.deep.equal([])
      })

      it('leaves it here, and says so, when the other space already has it', async () => {
        const { setlist } = await ready()
        await destination.saveSetlist(setlist)
        must($<AppModal>('#move-setlist-modal')).ask = async () => true
        await rig.page.moveSetlist(target.id)
        expect(await rig.db.getSetlist(setlist.id)).to.not.equal(undefined)
        expect(shownToast()?.message).to.contain('already in')
      })

      it('is asked for by the info dialog', async () => {
        const { setlist, dialog } = await ready()
        must($<AppModal>('#move-setlist-modal')).ask = async () => true
        dialog.dispatchEvent(new SetlistInfoMoveEvent(setlist.id, target.id))
        await waitUntil(
          async () => (await destination.getSetlist(setlist.id)) !== undefined,
          'the setlist to be moved'
        )
      })

      it('says what went wrong, and keeps it here, when the other space cannot be written', async () => {
        const { setlist } = await ready()
        must($<AppModal>('#move-setlist-modal')).ask = async () => true
        const real = Object.getPrototypeOf(destination).saveSetlist
        Object.getPrototypeOf(destination).saveSetlist = () =>
          Promise.reject(new Error('disk full'))
        try {
          await rig.page.moveSetlist(target.id)
        } finally {
          Object.getPrototypeOf(destination).saveSetlist = real
        }
        expect(shownToast()).to.include({ kind: 'error', details: 'disk full' })
        expect(await rig.db.getSetlist(setlist.id)).to.not.equal(undefined)
      })

      it('does nothing for a space that is not there, or with no setlist', async () => {
        const { setlist } = await ready()
        await rig.page.moveSetlist('no-such-space')
        rig.page.currentSetlist = undefined
        await rig.page.moveSetlist(target.id)
        expect(await rig.db.getSetlist(setlist.id)).to.not.equal(undefined)
      })
    })

    it('says so, and keeps the setlist, when it cannot be deleted', async () => {
      const { setlist } = await ready()
      must($<AppModal>('#delete-setlist-modal')).ask = async () => true
      const real = Object.getPrototypeOf(rig.db).removeSetlist
      Object.getPrototypeOf(rig.db).removeSetlist = () => Promise.reject(new Error('disk full'))
      try {
        await rig.page.deleteSetlist()
      } finally {
        Object.getPrototypeOf(rig.db).removeSetlist = real
      }
      expect(shownToast()).to.include({ kind: 'error', details: 'disk full' })
      expect(await rig.db.getSetlist(setlist.id)).to.not.equal(undefined)
    })

    it('has no Undo to offer for a setlist that had already gone', async () => {
      const { setlist } = await ready()
      must($<AppModal>('#delete-setlist-modal')).ask = async () => {
        await rig.db.deleteSetlist(setlist.id)
        return true
      }
      await rig.page.deleteSetlist()
      expect(shownToast()?.action).to.equal(undefined)
    })

    it('says so when Undo cannot put the setlist back', async () => {
      const { setlist } = await ready()
      must($<AppModal>('#delete-setlist-modal')).ask = async () => true
      await rig.page.deleteSetlist()
      const undo = must(shownToast()?.action)
      const real = ChordlessDB.prototype.restoreSetlist
      ChordlessDB.prototype.restoreSetlist = () => Promise.reject(new Error('disk full'))
      try {
        undo.run()
        await waitUntil(() => shownToast()?.kind === 'error', 'the failure')
      } finally {
        ChordlessDB.prototype.restoreSetlist = real
      }
      expect(shownToast()?.message).to.contain("Couldn't bring the setlist back")
      expect(await rig.db.getSetlist(setlist.id)).to.equal(undefined)
    })

    it('puts up with storage being unavailable', async () => {
      await ready()
      must($<AppModal>('#delete-setlist-modal')).ask = async () => true
      const real = Storage.prototype.removeItem
      Storage.prototype.removeItem = () => {
        throw new Error('blocked')
      }
      try {
        await rig.page.deleteSetlist()
      } finally {
        Storage.prototype.removeItem = real
      }
      expect(urls().at(-1)).to.equal('/')
    })

    it('does nothing with no setlist', async () => {
      await ready()
      rig.page.currentSetlist = undefined
      await rig.page.deleteSetlist()
    })
  })

  describe('the menu', () => {
    function menu() {
      const element = document.createElement('nav-menu') as NavMenu
      element.id = 'nav-menu'
      document.body.append(element)
      return element
    }

    it('lists the songs, and goes to the one chosen, or the overview', async () => {
      const element = menu()
      await rig.open(3, { name: 'Harvest' })
      expect(element.songs).to.have.length(3)
      expect(element.setlistTitle).to.equal('Harvest')
      expect(element.showOverviewLink).to.equal(false)
      element.dispatchEvent(new MenuSongClickEvent(2))
      expect(urls().at(-1)).to.match(/\/song\/2$/)
      element.dispatchEvent(new MenuSongClickEvent(-1))
      element.dispatchEvent(new MenuOverviewClickEvent())
      expect(urls().at(-1)).to.not.match(/\/song\//)
      rig.page.showSong(0, true)
      rig.page.updateNavigationMenu()
      expect(element.showOverviewLink).to.equal(true)
    })

    it('names an unnamed setlist by its date and type', async () => {
      const element = menu()
      await rig.open(2, { name: '', type: 'Church Service' })
      expect(element.setlistTitle).to.contain('Church Service')
      await rig.page.saveSetlistDetails({
        date: '2099-02-02',
        time: '',
        type: '',
        name: '',
        leaderId: '',
      })
      expect(element.setlistTitle).to.not.contain(' - ')
    })

    it('is emptied when the page goes, and when the setlist has no songs', async () => {
      const element = menu()
      await rig.open(0)
      expect(element.songs).to.have.length(0)
      expect(element.setlistTitle).to.equal('Setlist')
      await rig.open(2)
      rig.page.dispose()
      expect(element.songs).to.have.length(0)
    })

    it('is not needed', async () => {
      await rig.open()
      rig.page.updateNavigationMenu()
    })
  })

  describe('the keyboard', () => {
    it('moves between the overview and the songs with the arrows', async () => {
      await rig.open()
      press('ArrowRight')
      expect(urls().at(-1)).to.match(/\/song\/0$/)
      rig.page.showSong(0, true)
      press('ArrowRight')
      expect(urls().at(-1)).to.match(/\/song\/1$/)
      rig.page.showSong(2, true)
      const count = rig.visited.length
      press('ArrowRight')
      expect(rig.visited.length).to.equal(count)
      press('ArrowLeft')
      expect(urls().at(-1)).to.match(/\/song\/1$/)
      rig.page.showSong(0, true)
      press('ArrowLeft')
      expect(urls().at(-1)).to.not.match(/\/song\//)
      rig.page.showOverview(true)
      const before = rig.visited.length
      press('ArrowLeft')
      expect(rig.visited.length).to.equal(before)
    })

    it('scrolls with up and down', async () => {
      await rig.open()
      const calls: ScrollToOptions[] = []
      for (const id of ['#overview', '#song-0']) {
        const section = must($<HTMLElement>(id))
        section.scrollBy = ((options: ScrollToOptions) => {
          calls.push(options)
        }) as typeof section.scrollBy
      }
      press('ArrowDown')
      press('ArrowUp')
      rig.page.showSong(0, true)
      press('ArrowDown')
      press('ArrowUp')
      expect(calls.map(call => call.top)).to.deep.equal([200, -200, 200, -200])
    })

    it('leaves the keys to whoever is typing, or has a modifier down, or a modal open', async () => {
      await rig.open()
      const input = document.createElement('input')
      document.body.append(input)
      const typed = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      })
      input.dispatchEvent(typed)
      input.remove()
      expect(typed.defaultPrevented).to.equal(false)
      expect(press('ArrowRight', { ctrlKey: true }).defaultPrevented).to.equal(false)
      expect(press('ArrowRight', { altKey: true }).defaultPrevented).to.equal(false)
      expect(press('ArrowRight', { metaKey: true }).defaultPrevented).to.equal(false)
      expect(press('x').defaultPrevented).to.equal(false)
      const dialog = document.createElement('dialog')
      const button = document.createElement('button')
      dialog.append(button)
      document.body.append(dialog)
      dialog.showModal()
      const inModal = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
        composed: true,
      })
      button.dispatchEvent(inModal)
      dialog.close()
      dialog.remove()
      expect(inModal.defaultPrevented).to.equal(false)
    })

    it('stops listening when the page goes', async () => {
      await rig.open()
      rig.page.dispose()
      expect(press('ArrowRight').defaultPrevented).to.equal(false)
    })
  })
})
