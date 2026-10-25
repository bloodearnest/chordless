/**
 * The setlist page's header and the ways about it: the overview, the songs, edit mode, the info
 * dialogs, sharing, the menu and the keyboard. (Reordering, adding and removing songs are in
 * setlist-page.test.ts; sections, keys and tempo in setlist-page-songs.test.ts.)
 */
import { expect } from '@open-wc/testing'
import type { AppHeader } from '../src/components/app-header.ts'
import {
  EditModeToggleEvent,
  HeaderExpandToggleEvent,
  HeaderInfoClickEvent,
} from '../src/components/app-header.ts'
import type { AppModal } from '../src/components/app-modal.ts'
import {
  MenuOverviewClickEvent,
  MenuSongClickEvent,
  type NavMenu,
} from '../src/components/nav-menu.ts'
import { SetlistRevertedEvent } from '../src/components/setlist-differs.ts'
import {
  SetlistInfoDeleteEvent,
  type SetlistInfoDialog,
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
import { SongChangeEvent } from '../src/js/app-events.ts'
import { setCapoPreference } from '../src/js/preferences.ts'
import { getCurrentSpace, setSpaceReadOnly } from '../src/js/space.ts'
import { must, useSetlistPage } from './setlist-page-harness.ts'
import { shownToast, wait } from './test-helpers.ts'

const { describe, it, afterEach } = window

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
      const overview = must(rig.page._overviewComponent)
      overview.dispatchEvent(new OverviewSongClickEvent(1))
      expect(urls().at(-1)).to.match(/\/song\/1$/)

      let asked = 0
      const modal = must($<AppModal>('#delete-song-modal'))
      modal.ask = async () => {
        asked++
        return false
      }
      overview.dispatchEvent(new OverviewSongDeleteEvent(0))
      await wait(10)
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
      must(rig.page._overviewComponent).dispatchEvent(new OverviewSongKeyChangeEvent(0, 'A'))
      await wait(100)
      expect(must(await rig.db.getSetlist(setlist.id)).songs[0].key).to.equal('A')
      must(rig.page._overviewComponent).dispatchEvent(new OverviewSongKeyChangeEvent(0, ''))
    })

    it('changes the tempo of a song when told to', async () => {
      const setlist = await rig.open()
      must(rig.page._overviewComponent).dispatchEvent(new OverviewSongBpmChangeEvent(0, 88))
      await wait(100)
      expect(must(await rig.db.getSetlist(setlist.id)).songs[0].tempo).to.equal(88)
    })

    it('removes the listeners from a component it replaces', async () => {
      await rig.open()
      const first = must(rig.page._overviewComponent)
      await rig.page.renderSetlist(rig.page.currentSetlistId as string)
      expect(rig.page._overviewComponent).to.not.equal(first)
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
      rig.page._restoredState = { scrolls: { 'song-0': 30, 'song-9': 5 } }
      rig.page._restoreScrolls()
      expect(section.scrollTop).to.equal(30)
      expect(rig.page._restoredState).to.equal(undefined)
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
      expect(rig.page.overviewEditMode).to.equal(true)
      expect(header().editMode).to.equal(true)
      expect(rig.page._overviewComponent?.editMode).to.equal(true)
      rig.page.showSong(0, true)
      expect(rig.page.overviewEditMode).to.equal(false)
      expect(header().editMode).to.equal(false)
      rig.page.setOverviewEditMode(false)
    })

    it('is a song’s own, entered and left, saving the setlist when it is left', async () => {
      const setlist = await rig.open()
      rig.page.showSong(0, true)
      header().dispatchEvent(new EditModeToggleEvent())
      expect(document.body.classList.contains('edit-mode')).to.equal(true)
      expect(
        $('#key-selector') && ($('#key-selector') as unknown as { editMode: boolean }).editMode
      ).to.equal(true)
      await wait(300)
      expect(
        $$('.normal-mode-control').every(el => el.classList.contains('fade-complete'))
      ).to.equal(true)
      const before = must(await rig.db.getSetlist(setlist.id)).modifiedDate
      await wait(5)
      header().dispatchEvent(new EditModeToggleEvent())
      expect(document.body.classList.contains('edit-mode')).to.equal(false)
      await wait(400)
      expect(must(await rig.db.getSetlist(setlist.id)).modifiedDate).to.not.equal(before)
    })

    it('lets a user who can only read change a song’s key too', async () => {
      const { id } = getCurrentSpace()
      await setSpaceReadOnly(must(id), true)
      await rig.open()
      rig.page.showSong(0, true)
      header().dispatchEvent(new EditModeToggleEvent())
      expect(($('#key-selector') as unknown as { editMode: boolean }).editMode).to.equal(true)
      header().dispatchEvent(new EditModeToggleEvent())
      await wait(300)
    })

    it('has the capo selector editable too when the capo is on', async () => {
      setCapoPreference(true)
      await rig.open()
      rig.page.showSong(0, true)
      header().dispatchEvent(new EditModeToggleEvent())
      expect(($('#capo-selector') as unknown as { editMode: boolean }).editMode).to.equal(true)
      header().dispatchEvent(new EditModeToggleEvent())
      await wait(300)
    })

    it('is left with Escape, and a song’s edits are saved by leaving it', async () => {
      await rig.open()
      rig.page.showSong(0, true)
      header().dispatchEvent(new EditModeToggleEvent())
      expect(press('Escape').defaultPrevented).to.equal(true)
      expect(document.body.classList.contains('edit-mode')).to.equal(false)
      await wait(300)
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
      await rig.page.updateHeader(rig.page.songs[0], true)
      expect(header().heading).to.equal('Alpha')
      rig.page.currentSetlist = undefined
      await rig.page.updateHeader(null, true)
      expect(header().heading).to.equal('Setlist')
    })

    it('changes with a fade when it is not told to be quick, and not at all when nothing changes', async () => {
      await rig.open()
      await rig.page.updateHeader(rig.page.songs[0], false)
      expect(header().heading).to.equal('Alpha')
      await rig.page.updateHeader(rig.page.songs[0], false)
      expect(($('.header-controls-slot') as HTMLElement).style.opacity).to.equal('1')
    })

    it('offers the edit toggle on the overview to a user who can only read too', async () => {
      const { id } = getCurrentSpace()
      await setSpaceReadOnly(must(id), true)
      await rig.open()
      expect(header().showEditToggle).to.equal(true)
      await rig.page.updateHeader(rig.page.songs[0], true)
      expect(header().showEditToggle).to.equal(true)
    })

    it('shows the edit toggle on a setlist that was received by link (it hides chords and sections)', async () => {
      await rig.open(3, {}, { readOnly: true })
      await rig.page.updateHeader(null, true)
      expect(header().showEditToggle).to.equal(true)
      await rig.page.updateHeader(rig.page.songs[0], true)
      expect(header().showEditToggle).to.equal(true)
    })

    it('shows a song with no key without a key list', async () => {
      await rig.open()
      rig.page.songs[0].currentKey = undefined
      await rig.page.updateHeader(rig.page.songs[0], true)
      expect(($('#key-selector') as unknown as { value: string }).value).to.equal('-')
    })

    it('widens and narrows with its toggle', async () => {
      await rig.open()
      header().dispatchEvent(new HeaderExpandToggleEvent(true))
      expect(document.body.classList.contains('header-expanded')).to.equal(true)
      header().dispatchEvent(new HeaderExpandToggleEvent(false))
      expect(document.body.classList.contains('header-expanded')).to.equal(false)
    })

    it('does nothing for a header that is not there', async () => {
      await rig.open()
      rig.root.querySelector('#app-header')?.remove()
      await rig.page.updateHeader(null, true)
      rig.page.updateKeySelector('G')
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
      await rig.page.updateHeader(rig.page.songs[0], true)
      expect(button.hidden).to.equal(true)
      await rig.page.updateHeader(null, true)
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
      await rig.page.updateHeader(rig.page.songs[0], true)
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
      rig.page._refreshDiffers()
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
      await wait(30)
      expect(shownSetlists).to.have.length(1)
      rig.page.showSong(0, true)
      await rig.page.updateHeader(rig.page.songs[0], true)
      header().dispatchEvent(new HeaderInfoClickEvent())
      await wait(30)
      expect(shownSongs).to.have.length(1)
      expect(shownSongs[0][0]).to.equal(rig.page.songs[0].songId)
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

  describe('the setlist’s details', () => {
    const changes = (name: string) => ({
      date: '2099-02-02',
      time: '09:00',
      type: 'Event',
      name,
      owner: 'Ann',
      ownerId: 'ann@example.com',
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
      await wait(50)
      expect(must(await rig.db.getSetlist(rig.page.currentSetlistId as string)).name).to.equal(
        'Renamed'
      )
      expect(reshown).to.be.greaterThan(0)
      rig.page.showSong(0, true)
      await rig.page.saveSetlistDetails(changes('Again'))
      expect(header().heading).to.equal('Alpha')
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
      await wait(80)
      expect(await rig.db.getSetlist(setlist.id)).to.equal(undefined)
      expect(localStorage.getItem(`state-${setlist.id}`)).to.equal(null)
      expect(urls().at(-1)).to.equal('/')
    })

    it('does nothing when it is not confirmed', async () => {
      const { setlist } = await ready()
      must($<AppModal>('#delete-setlist-modal')).ask = async () => false
      await rig.page.deleteSetlist()
      expect(await rig.db.getSetlist(setlist.id)).to.not.equal(undefined)
    })

    it('says why it cannot, when the setlist is in Drive', async () => {
      const { setlist } = await ready()
      must(rig.page.currentSetlist).fileRef = 'in-drive'
      await rig.db.saveSetlist({ ...setlist, fileRef: 'in-drive' })
      must($<AppModal>('#delete-setlist-modal')).ask = async () => true
      await rig.page.deleteSetlist()
      expect(shownToast()?.message).to.contain("Couldn't delete the setlist")
      expect(await rig.db.getSetlist(setlist.id)).to.not.equal(undefined)
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
        owner: '',
        ownerId: '',
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
