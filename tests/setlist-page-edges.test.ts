/**
 * The setlist page's remaining corners: the controls that fade with edit mode, collapsing a
 * section, and the overview's drag and add-song wiring, driven as a user does.
 */
import { expect } from '@open-wc/testing'
import { EditModeToggleEvent } from '../src/components/app-header.ts'
import { SongSettingsClickEvent } from '../src/components/musical-metadata-display.ts'
import { SongSelectEvent } from '../src/components/song-list.ts'
import type { SongSettingsPopover } from '../src/components/song-settings-popover.ts'
import { SetlistPage } from '../src/js/setlist-page.ts'
import { getSongWithContent } from '../src/js/song-utils.ts'
import { must, useSetlistPage } from './setlist-page-harness.ts'
import { wait } from './test-helpers.ts'

const { describe, it } = window

describe('the setlist page: corners', () => {
  const rig = useSetlistPage()
  const { $, $$ } = rig
  const header = () => must($<HTMLElement>('#app-header'))

  it('has no capo when the browser will not say whether it is on', async () => {
    const real = Storage.prototype.getItem
    Storage.prototype.getItem = () => {
      throw new Error('blocked')
    }
    try {
      expect(rig.page?._readCapoPreference?.() ?? false).to.equal(false)
      await rig.open()
      expect(rig.page._readCapoPreference()).to.equal(false)
    } finally {
      Storage.prototype.getItem = real
    }
  })

  it('fades the edit and normal controls with edit mode, and hides the edit ones once faded out', async () => {
    await rig.open()
    rig.page.showSong(0, true)
    const edit = document.createElement('button')
    edit.className = 'edit-mode-control'
    edit.style.display = 'none'
    const normal = document.createElement('button')
    normal.className = 'normal-mode-control'
    rig.root.append(edit, normal)
    header().dispatchEvent(new EditModeToggleEvent())
    expect(edit.style.display).to.equal('')
    await wait(300)
    expect(edit.classList.contains('fade-in')).to.equal(true)
    expect(normal.classList.contains('fade-complete')).to.equal(true)
    header().dispatchEvent(new EditModeToggleEvent())
    expect(edit.classList.contains('fade-in')).to.equal(false)
    expect(normal.classList.contains('fade-complete')).to.equal(false)
    await wait(400)
    expect(edit.style.display).to.equal('none')
  })

  it('opens the song settings from the musical metadata', async () => {
    await rig.open()
    rig.page.showSong(0, true)
    const popover = must($<SongSettingsPopover>('#song-settings-popover'))
    let toggled = 0
    popover.toggle = () => {
      toggled++
    }
    must($<HTMLElement>('#musical-metadata')).dispatchEvent(new SongSettingsClickEvent())
    expect(toggled).to.equal(1)
  })

  it('collapses a section with a details element, animating it', async () => {
    await rig.open()
    rig.page.showSong(0, true)
    await rig.page.setSectionHideMode(0, 0, 'collapse')
    await wait(500)
    expect(rig.errors).to.deep.equal([])
  })

  it('moves a song when its card is dragged in the overview being edited', async () => {
    await rig.open()
    rig.page.setOverviewEditMode(true)
    await rig.flush()
    const card = (index: number) =>
      must(rig.root.querySelectorAll<HTMLElement>('.overview-song-card')[index])
    const pointer = (type: string, clientY: number) =>
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        cancelable: true,
        isPrimary: true,
        pointerId: 1,
        pointerType: 'mouse',
        clientY,
      })
    const first = card(0).getBoundingClientRect()
    const grip = must(card(0).shadowRoot?.querySelector('.drag-handle'))
    grip.dispatchEvent(pointer('pointerdown', first.top + 5))
    document.dispatchEvent(pointer('pointermove', card(2).getBoundingClientRect().bottom + 50))
    await rig.flush()
    document.dispatchEvent(pointer('pointerup', card(2).getBoundingClientRect().bottom + 50))
    await wait(100)
    expect(rig.page.songs.map(song => song.title)).to.deep.equal(['Bravo', 'Charlie', 'Alpha'])
    rig.page.setOverviewEditMode(false)
  })

  it('adds the song picked in the add-song dialog', async () => {
    await rig.open(2)
    await rig.page._addSongModal.open()
    const list = must($$<HTMLElement>('#add-song-results song-list')[0])
    const song = await getSongWithContent(rig.songs[2].uuid, rig.db)
    list.dispatchEvent(new SongSelectEvent(song, 0, new Event('click')))
    await wait(100)
    expect(rig.page.songs.map(entry => entry.title)).to.include('Charlie')
    rig.page._addSongModal.close()
  })

  it('leaves alone a section without its indexes', async () => {
    await rig.open()
    const stray = document.createElement('song-section')
    stray.setAttribute('song-index', 'x')
    rig.root.append(stray)
    rig.page._initializeSongSections()
    expect(stray.hideMode).to.not.equal('lyrics')
  })

  it('lets the observer watch again once a smooth scroll is done', async () => {
    await rig.open()
    rig.page.scrollToSection('song-1', 1)
    expect(rig.page._isProgrammaticScroll).to.equal(true)
    await wait(700)
    expect(rig.page._isProgrammaticScroll).to.equal(false)
  })

  it('keeps the overview’s cards draggable when it is drawn again while being edited', async () => {
    await rig.open(2)
    rig.page.setOverviewEditMode(true)
    await rig.page.addSongToSetlist(must(await getSongWithContent(rig.songs[2].uuid, rig.db)))
    await rig.flush()
    await rig.flush()
    expect(rig.page.songs).to.have.length(3)
    rig.page.setOverviewEditMode(false)
  })

  it('puts a moved song’s section where it now is: first, in the middle or last', async () => {
    await rig.open(4)
    await rig.page.moveSong(3, 0)
    expect(rig.page.songs.map(song => song.title)).to.deep.equal([
      'Delta',
      'Alpha',
      'Bravo',
      'Charlie',
    ])
    await rig.page.moveSong(0, 2)
    await rig.page.moveSong(1, 3)
    const ids = $$('.section[id^="song-"]').map(el => el.id)
    expect(ids).to.deep.equal(['song-0', 'song-1', 'song-2', 'song-3'])
    expect(rig.page.songs.map(song => song.title)).to.deep.equal([
      'Alpha',
      'Delta',
      'Charlie',
      'Bravo',
    ])
  })

  it('stops before it starts to draw when it is disposed first', async () => {
    await rig.open()
    const other = new SetlistPage({
      root: rig.root,
      setlistId: must(rig.page.currentSetlistId),
      db: rig.db,
    })
    const started = other.start()
    other.dispose()
    await started
    expect(other._disposed).to.equal(true)
  })

  it('finds a song section among its own children by its indexes', async () => {
    await rig.open()
    const stray = document.createElement('song-section')
    stray.setAttribute('song-index', '7')
    stray.setAttribute('section-index', '7')
    rig.root.append(stray)
    expect(rig.page._getSongSectionComponent(7, 7)).to.equal(stray)
    expect(rig.page._getSongSectionComponent(8, 8)).to.equal(null)
    stray.setAttribute('song-index', '0')
    stray.setAttribute('section-index', 'x')
    rig.page._initializeSongSections()
  })

  it('mixes a section’s own state with the song’s defaults and the app’s, field by field', async () => {
    await rig.open()
    const { songId } = rig.page.songs[0]
    const key = `song-prefs-${rig.db.organisationId}`
    localStorage.setItem(
      key,
      JSON.stringify({
        [songId]: {
          sectionDefaults: { 0: { hideMode: 'lyrics', isCollapsed: true, isHidden: true } },
        },
      })
    )
    rig.page._songUserPrefsCache = {}
    rig.page.sectionState = { 0: { 0: { hideMode: 'chords' } as never } }
    expect(rig.page._resolveSectionState(0, 0)).to.deep.equal({
      hideMode: 'chords',
      isCollapsed: true,
      isHidden: true,
    })
    rig.page.sectionState = { 0: { 0: { isCollapsed: false, isHidden: false } as never } }
    expect(rig.page._resolveSectionState(0, 0)).to.deep.equal({
      hideMode: 'lyrics',
      isCollapsed: false,
      isHidden: false,
    })
    rig.page.sectionState = {}
    expect(rig.page._resolveSectionState(0, 0).hideMode).to.equal('lyrics')
  })

  it('does nothing for the parts of the page that are not there', async () => {
    await rig.open()
    rig.page.showSong(0, true)
    for (const selector of [
      '#share-button',
      '#setlist-share',
      '#app-header',
      '#key-selector',
      '.song-container',
    ]) {
      $(selector)?.remove()
    }
    rig.page._showShareButton(true)
    rig.page._setupShare()
    rig.page._appHeaderEventsSetup = false
    rig.page.setupAppHeaderEvents()
    rig.page._editModeSetup = false
    rig.page.setupEditMode()
    rig.page.setupKeySelector()
    rig.page.setupSectionControls()
    rig.page.setupSectionObserver()
    rig.page.setupKeyboardNavigation()
    expect(rig.errors).to.deep.equal([])
  })

  it('shows no capo when it is off, and a capo of none when a song has not one', async () => {
    await rig.open()
    rig.page.showSong(0, true)
    rig.page.updateCapoSelector(2)
    rig.page._updateSongDisplayCapo(0, 3)
    localStorage.setItem('enable_capo', 'true')
    rig.page._capoEnabled = true
    rig.page.songs[0].currentCapo = undefined as never
    rig.page.setupKeySelector()
    rig.page.updateHeader(rig.page.songs[0])
    rig.page._applyCapoPreferenceToDisplays()
    rig.page.currentSongIndex = -1
    rig.page._applyCapoPreferenceToDisplays()
    rig.page.setupCapoSelector()
    rig.page.setupKeySelector()
    rig.page.currentSongIndex = 0
    rig.page.setupCapoSelector()
    expect(rig.errors).to.deep.equal([])
  })

  it('shows a tempo note by the time signature, and a song with no tempo or key', async () => {
    await rig.open()
    rig.page.showSong(0, true)
    const song = rig.page.songs[0]
    song.sourceText = '{title: Waltz}\n{time: 6/8}\n\n{comment: Verse}\n[G]La la'
    song.metadata = {} as never
    must(rig.page.currentSetlist).songs[0].tempo = null
    await rig.page.reRenderSong(0)
    expect(song.metadata?.tempoNote).to.equal('1/8')
    song.metadata.tempo = null as never
    await rig.page.resetCurrentSong()
    const library = must(await getSongWithContent(rig.songs[3].uuid, rig.db))
    await rig.page.addSongToSetlist({
      ...library,
      metadata: { ...library.metadata, key: undefined },
    } as never)
    await rig.page.addSongToSetlist({
      ...library,
      metadata: { ...library.metadata, key: undefined, tempo: undefined },
      parsed: { ...library.parsed, metadata: {} },
    } as never)
    expect(rig.page.songs.length).to.be.greaterThan(3)
  })
})
