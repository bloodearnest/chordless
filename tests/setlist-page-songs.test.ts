/**
 * What the setlist page does with a song's sections, key, tempo, capo and settings, and the state
 * it keeps. (Moving between songs and the header are in setlist-page-header.test.ts.)
 */

import { expect, waitUntil } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import { CapoChangeEvent } from '../src/components/capo-selector.ts'
import { KeyChangeEvent } from '../src/components/key-selector.ts'
import { SectionActionEvent, SectionToggleEvent } from '../src/components/song-section.ts'
import {
  BpmChangeEvent,
  PadSetChoiceEvent,
  SongResetClickEvent,
  type SongSettingsPopover,
} from '../src/components/song-settings-popover.ts'
import { DoubleClickToggleEvent, SongChangeEvent } from '../src/js/app-events.ts'
import {
  CapoPreferenceEvent,
  SectionDefaultsEvent,
  setCapoPreference,
} from '../src/js/preferences.ts'
import { loadSetlistLocalState } from '../src/js/setlist/local-state.ts'
import { getSongUserPrefs, saveSongUserPrefs } from '../src/js/song-user-prefs.ts'
import { getCurrentSpace, setSpaceReadOnly } from '../src/js/space.ts'
import { chartOf, must, useSetlistPage } from './setlist-page-harness.ts'
import { wait } from './test-helpers.ts'

const { describe, it, afterEach } = window

describe('the setlist page: sections, key, tempo and capo', () => {
  const rig = useSetlistPage()
  const { $ } = rig

  afterEach(async () => {
    const { id } = getCurrentSpace()
    if (id) await setSpaceReadOnly(id, false)
    localStorage.removeItem(`state-${rig.page?.currentSetlistId}`)
  })

  const section = (song: number, index: number) => must(rig.page.sections.find(song, index))
  const popover = () => must($<SongSettingsPopover>('#song-settings-popover'))
  const setReadOnly = async () => setSpaceReadOnly(must(getCurrentSpace().id), true)

  describe('the sections’ states', () => {
    it('start from the app’s defaults', async () => {
      await rig.open()
      expect(section(0, 0).hideMode).to.equal('none')
      expect(rig.page.sections.resolve(0, 0)).to.deep.equal({
        hideMode: 'none',
        isCollapsed: false,
        isHidden: false,
      })
    })

    it('follow what the user chose for every section, or for one by its name', async () => {
      localStorage.setItem(
        'section_defaults',
        JSON.stringify({ all: 'lyrics', chorus: 'hide', 'verse 1': 'collapse' })
      )
      await rig.open()
      expect(rig.page.sections.resolve(0, 0, section(0, 0)).hideMode).to.equal('collapse')
      expect(rig.page.sections.resolve(0, 1, section(0, 1)).hideMode).to.equal('hide')
    })

    it('are collapsed when what the user chose has nothing to show in a section', async () => {
      await rig.open()
      const chordsOnly = { getRecommendedHideMode: () => 'lyrics', dataset: {}, label: '' } as never
      const lyricsOnly = { getRecommendedHideMode: () => 'chords', dataset: {}, label: '' } as never
      localStorage.setItem('section_defaults', JSON.stringify({ all: 'lyrics' }))
      expect(rig.page.sections.defaultHideModeFor(chordsOnly, 0, 0)).to.equal('collapse')
      expect(rig.page.sections.defaultHideModeFor(lyricsOnly, 0, 0)).to.equal('chords')
      localStorage.setItem('section_defaults', JSON.stringify({ all: 'chords' }))
      expect(rig.page.sections.defaultHideModeFor(lyricsOnly, 0, 0)).to.equal('collapse')
      expect(rig.page.sections.defaultHideModeFor(chordsOnly, 0, 0)).to.equal('lyrics')
      localStorage.setItem('section_defaults', JSON.stringify({ all: 'all' }))
      expect(rig.page.sections.defaultHideModeFor(chordsOnly, 0, 0)).to.equal('lyrics')
    })

    it('are the user’s own for a song, then the setlist’s own over those', async () => {
      await rig.open()
      const spaceId = rig.db.spaceId
      saveSongUserPrefs(rig.page.songs[0].songId, spaceId, {
        sectionDefaults: { '0': { hideMode: 'chords', isCollapsed: true, isHidden: false } },
      })
      expect(rig.page.sections.resolve(0, 0)).to.deep.equal({
        hideMode: 'chords',
        isCollapsed: true,
        isHidden: false,
      })
      rig.page.sections.states = {
        0: { 0: { hideMode: 'hide', isCollapsed: false, isHidden: true } },
      }
      expect(rig.page.sections.resolve(0, 0)).to.deep.equal({
        hideMode: 'hide',
        isCollapsed: false,
        isHidden: true,
      })
      expect(rig.page.sections.userDefaults(0, 5)).to.equal(null)
      expect(rig.page.sections.userDefaults(99, 0)).to.equal(null)
      rig.page.songs[1].songId = ''
      expect(rig.page.sections.userDefaults(1, 0)).to.equal(null)
    })

    it('are not the user’s when what they saved cannot be read', async () => {
      await rig.open()
      localStorage.setItem(`song-prefs-${rig.db.spaceId}`, '{not json')
      expect(rig.page.sections.userDefaults(0, 0)).to.equal(null)
    })

    it('are the setlist’s own once one is set, and kept for the others to see', async () => {
      await rig.open()
      const state = rig.page.sections.ensureOverride(0, 1)
      // (this section has only words, so only words are shown by default)
      expect(state).to.deep.equal({ hideMode: 'chords', isCollapsed: false, isHidden: false })
      expect(rig.page.sections.ensureOverride(0, 1)).to.equal(state)
    })
  })

  describe('a section’s controls', () => {
    const act = (song: number, index: number, action: string) =>
      $('.song-container')?.dispatchEvent(new SectionActionEvent(song, index, action))

    it('show chords, lyrics or both, as the action says, and again when it is pressed twice', async () => {
      await rig.open()
      act(0, 0, 'show-lyrics')
      await wait(50)
      expect(section(0, 0).hideMode).to.equal('chords')
      act(0, 0, 'show-chords')
      await wait(50)
      expect(section(0, 0).hideMode).to.equal('lyrics')
      act(0, 0, 'show-all')
      await wait(50)
      expect(section(0, 0).hideMode).to.equal('none')
      await rig.page.sections.setHideMode(0, 0, 'chords')
      expect(rig.page.sections.states[0][0].hideMode).to.equal('chords')
      await rig.page.sections.setHideMode(0, 0, 'chords')
      expect(rig.page.sections.states[0][0].hideMode).to.equal('none')
    })

    it('hide a section outright, which showing it any way brings back, and toggle hiding', async () => {
      await rig.open()
      await rig.page.sections.setHideMode(0, 0, 'show-none')
      expect(section(0, 0).isHidden).to.equal(true)
      await rig.page.sections.setHideMode(0, 0, 'show-lyrics')
      expect(section(0, 0).isHidden).to.equal(false)
      await rig.page.sections.setHideMode(0, 1, 'hide')
      expect(rig.page.sections.states[0][1].isHidden).to.equal(true)
      await rig.page.sections.setHideMode(0, 1, 'hide')
      expect(rig.page.sections.states[0][1].isHidden).to.equal(false)
      expect(rig.page.sections.states[0][1].hideMode).to.equal('none')
    })

    it('open a collapsed section again, and collapse an open one', async () => {
      await rig.open()
      rig.page.sections.states = {
        0: { 0: { hideMode: 'collapse', isCollapsed: true, isHidden: false } },
      }
      rig.page.sections.applyAll()
      await rig.page.sections.setHideMode(0, 0, 'show-lyrics')
      expect(rig.page.sections.states[0][0].isCollapsed).to.equal(false)

      $('.song-container')?.dispatchEvent(new SectionToggleEvent(0, 1))
      await wait(500)
      expect(rig.page.sections.states[0][1].isCollapsed).to.equal(true)
      $('.song-container')?.dispatchEvent(new SectionToggleEvent(0, 1))
      await wait(500)
      expect(rig.page.sections.states[0][1].isCollapsed).to.equal(false)
    })

    it('do nothing for a section that is not there', async () => {
      await rig.open()
      act(0, 9, 'show-lyrics')
      $('.song-container')?.dispatchEvent(new SectionToggleEvent(0, 9))
      rig.page.sections.updateDOM(0, 9)
      await rig.page.sections.animateToggle(0, 0, document.createElement('details'))
      $('.song-container')?.dispatchEvent(new CustomEvent(SectionActionEvent.type, { detail: {} }))
      $('.song-container')?.dispatchEvent(new CustomEvent(SectionToggleEvent.type))
    })

    it('are set up once', async () => {
      await rig.open()
      rig.page.sections.listen()
      let saves = 0
      rig.page.saveState = () => {
        saves++
      }
      act(0, 0, 'show-lyrics')
      await wait(0)
      expect(saves).to.equal(1)
    })
  })

  describe('the state it keeps', () => {
    it('reads the song models’ format, with the capos', async () => {
      setCapoPreference(true)
      const setlist = await rig.open()
      localStorage.setItem(
        `state-${setlist.id}`,
        JSON.stringify({
          sectionState: { 0: { 0: { hideMode: 'chords', isCollapsed: false, isHidden: false } } },
          capoValues: { 1: 3, 9: 2 },
        })
      )
      rig.page.loadState()
      expect(rig.page.sections.states[0][0].hideMode).to.equal('chords')
      expect(rig.page.songs[1].currentCapo).to.equal(3)
    })

    it('reads the older format, and the capos kept in it', async () => {
      setCapoPreference(true)
      const setlist = await rig.open()
      localStorage.setItem(
        `state-${setlist.id}`,
        JSON.stringify({
          0: { 1: { hideMode: 'hide', isCollapsed: false, isHidden: true } },
          capo: { 2: 4 },
        })
      )
      rig.page.loadState()
      expect(rig.page.sections.states[0][1].isHidden).to.equal(true)
      expect(rig.page.songs[2].currentCapo).to.equal(4)
    })

    it('starts again from nothing when what is kept cannot be read, or there is nothing', async () => {
      const setlist = await rig.open()
      localStorage.setItem(`state-${setlist.id}`, '{not json')
      rig.page.loadState()
      expect(rig.page.sections.states).to.deep.equal({})
      localStorage.removeItem(`state-${setlist.id}`)
      rig.page.loadState()
      expect(rig.page.sections.states).to.deep.equal({})
    })

    it('uses the capo the user prefers for a song, in the key it is in, unless one is set', async () => {
      setCapoPreference(true)
      await rig.open()
      saveSongUserPrefs(rig.page.songs[0].songId, rig.db.spaceId, { capo: 3 })
      saveSongUserPrefs(rig.page.songs[1].songId, rig.db.spaceId, { capo: 5 })
      saveSongUserPrefs(rig.page.songs[2].songId, rig.db.spaceId, { capo: 2 })
      rig.page.songs.forEach(song => {
        song.currentCapo = 0
      })
      rig.page.songs[1].currentCapo = 4
      must(rig.page.currentSetlist).songs[2].key = 'A'
      await rig.page._applyCapoDefaults()
      expect(rig.page.songs.map(song => song.currentCapo)).to.deep.equal([3, 4, 0])
    })

    it('uses no prefs when the capo is off, or the song has none, or the setlist lost its entry', async () => {
      await rig.open()
      await rig.page._applyCapoDefaults()
      setCapoPreference(true)
      rig.page._capoEnabled = true
      rig.page.songs.forEach(song => {
        song.currentCapo = 0
      })
      saveSongUserPrefs(rig.page.songs[0].songId, rig.db.spaceId, { doubleClick: true })
      saveSongUserPrefs(rig.page.songs[2].songId, rig.db.spaceId, { capo: 3 })
      must(rig.page.currentSetlist).songs.splice(2, 1)
      await rig.page._applyCapoDefaults()
      expect(rig.page.songs.map(song => song.currentCapo)).to.deep.equal([0, 0, 0])
    })

    it('saves the sections and the capos', async () => {
      setCapoPreference(true)
      const setlist = await rig.open()
      rig.page.songs[1].currentCapo = 4
      rig.page.sections.states = {
        0: { 0: { hideMode: 'chords', isCollapsed: false, isHidden: false } },
      }
      rig.page.saveState()
      const kept = loadSetlistLocalState(setlist.id, setlist.songs)
      expect(kept.capoValues).to.deep.equal({ 1: 4 })
      expect(kept.sectionState[0][0].hideMode).to.equal('chords')
      // (and under the songs, not their places)
      const stored = JSON.parse(must(localStorage.getItem(`state-${setlist.id}`)))
      expect(stored.capos).to.deep.equal({ [setlist.songs[1].songUuid]: 4 })
    })

    it('saves no capos when the capo is off', async () => {
      const setlist = await rig.open()
      rig.page.songs[1].currentCapo = 4
      rig.page.saveState()
      expect(loadSetlistLocalState(setlist.id, setlist.songs).capoValues).to.deep.equal({})
    })

    it('puts the sections back when the user’s defaults change, once the setlist is shown', async () => {
      await rig.open()
      window.dispatchEvent(new SectionDefaultsEvent('singer', { all: 'lyrics' }))
      rig.page.currentSongIndex = Number.NaN
      rig.page._handleSectionDefaultsChanged()
    })
  })

  describe('the key', () => {
    it('is changed with the selector, saved in the setlist, and shown', async () => {
      const setlist = await rig.open()
      rig.page.showSong(0, true)
      const dispatched: Array<string | undefined> = []
      document.addEventListener(
        SongChangeEvent.type,
        e => dispatched.push((e as SongChangeEvent).song?.currentKey),
        { once: true }
      )
      $('#key-selector')?.dispatchEvent(new KeyChangeEvent('A'))
      await waitUntil(
        async () => must(await rig.db.getSetlist(setlist.id)).songs[0].key === 'A',
        'the key is saved in the setlist',
        { timeout: 5000 }
      )
      expect(must(await rig.db.getSetlist(setlist.id)).songs[0].key).to.equal('A')
      expect(rig.page.songs[0].currentKey).to.equal('A')
      expect(dispatched[0]).to.equal('A')
    })

    it('is changed by a user who can only read too, but not with no song, or with no key', async () => {
      await rig.open()
      rig.page.showSong(0, true)
      await rig.page.handleKeyChange('')
      await rig.page.handleKeyChange('A')
      expect(rig.page.songs[0].currentKey).to.equal('A')
      await setReadOnly()
      await rig.page.handleKeyChange('B')
      expect(rig.page.songs[0].currentKey).to.equal('B')
      rig.page.showOverview(true)
      await rig.page.handleKeyChange('C')
    })

    it('is shown on the selector, editable in edit mode, for a reader too', async () => {
      await rig.open()
      rig.page.showSong(0, true)
      document.body.classList.add('edit-mode')
      rig.page.updateKeySelector('D')
      expect(($('#key-selector') as unknown as { editMode: boolean }).editMode).to.equal(true)
      await setReadOnly()
      rig.page.updateKeySelector('D')
      expect(($('#key-selector') as unknown as { editMode: boolean }).editMode).to.equal(true)
    })

    it('has the selector set up once', async () => {
      await rig.open()
      const handler = rig.page._keyChangeHandler
      rig.page.setupKeySelector()
      expect(rig.page._keyChangeHandler).to.equal(handler)
    })
  })

  describe('the tempo', () => {
    it('is changed from the settings, saved, and shown', async () => {
      const setlist = await rig.open()
      rig.page.showSong(0, true)
      popover().dispatchEvent(new BpmChangeEvent(100))
      await wait(150)
      expect(must(await rig.db.getSetlist(setlist.id)).songs[0].tempo).to.equal(100)
      expect(rig.page.songs[0].currentBPM).to.equal(100)
      expect(popover().bpmValue).to.equal(100)
      await rig.page.handleBPMChange(100)
    })

    it('is changed by a user who can only read too, but not with no song', async () => {
      await rig.open()
      await rig.page.handleBPMChange(80)
      expect(rig.page.songs[0].currentBPM).to.equal(90)
      rig.page.showSong(0, true)
      await setReadOnly()
      await rig.page.handleBPMChange(80)
      expect(rig.page.songs[0].currentBPM).to.equal(80)
    })
  })

  describe('the capo', () => {
    it('is changed with its selector, saved, and shown on the song', async () => {
      setCapoPreference(true)
      await rig.open()
      rig.page.showSong(0, true)
      $('#capo-selector')?.dispatchEvent(new CapoChangeEvent(4))
      await wait(150)
      expect(rig.page.songs[0].currentCapo).to.equal(4)
      expect(($('#song-0 song-display') as unknown as { capo: number }).capo).to.equal(4)
      await rig.page.handleCapoChange(4)
    })

    it('is not changed while it is off, or on the overview, or for a song that is not there', async () => {
      await rig.open()
      await rig.page.handleCapoChange(3)
      rig.page._capoEnabled = true
      await rig.page.handleCapoChange(3)
      rig.page.showSong(0, true)
      rig.page.songs[0] = undefined as never
      await rig.page.handleCapoChange(3)
      rig.page._updateSongDisplayCapo(-1, 2)
      rig.page._updateSongDisplayCapo(7, 2)
    })

    it('is hidden when it is off, and the selector is set up once when it is on', async () => {
      await rig.open()
      expect(($('#capo-selector') as HTMLElement).style.display).to.equal('none')
      setCapoPreference(true)
      window.dispatchEvent(new CapoPreferenceEvent(true))
      expect(($('#capo-selector') as HTMLElement).style.display).to.equal('')
      rig.page.setupCapoSelector()
      const handler = rig.page._capoChangeHandler
      rig.page.setupCapoSelector()
      expect(rig.page._capoChangeHandler).to.equal(handler)
      setCapoPreference(false)
      window.dispatchEvent(new CapoPreferenceEvent(false))
      expect(($('#capo-selector') as HTMLElement).style.display).to.equal('none')
      expect(($('#song-0 song-display') as unknown as { capo: number }).capo).to.equal(0)
    })

    it('is shown on the song being viewed when the preference is turned on', async () => {
      await rig.open()
      rig.page.showSong(1, true)
      rig.page.songs[1].currentCapo = 2
      setCapoPreference(true)
      window.dispatchEvent(new CapoPreferenceEvent(true))
      expect(($('#capo-selector') as unknown as { value: number }).value).to.equal(2)
    })

    it('does not draw the capo on a selector that is not there', async () => {
      setCapoPreference(true)
      await rig.open()
      rig.root.querySelector('#capo-selector')?.remove()
      rig.page.updateCapoSelector(2)
      rig.page.setupCapoSelector()
      rig.page._applyCapoPreferenceToDisplays()
    })
  })

  describe('the song’s settings', () => {
    it('keep the pad set chosen for the song, and tell the media player', async () => {
      await rig.open()
      rig.page.showSong(0, true)
      popover().dispatchEvent(new PadSetChoiceEvent('drive-warm'))
      expect(getSongUserPrefs(rig.page.songs[0].songId, rig.db.spaceId)?.padSetId).to.equal(
        'drive-warm'
      )
      popover().dispatchEvent(new PadSetChoiceEvent(undefined))
      expect(getSongUserPrefs(rig.page.songs[0].songId, rig.db.spaceId)).to.equal(null)
    })

    it('keep the double click from the player’s speed button, for the song being shown', async () => {
      await rig.open()
      rig.page.showSong(0, true)
      document.dispatchEvent(new DoubleClickToggleEvent(true))
      expect(getSongUserPrefs(rig.page.songs[0].songId, rig.db.spaceId)?.doubleClick).to.equal(true)
    })

    it('are those of the song being viewed only', async () => {
      await rig.open()
      popover().bpmValue = 7
      rig.page.updateSongSettingsPopover()
      expect(popover().bpmValue).to.equal(7)
      rig.root.querySelector('#song-settings-popover')?.remove()
      rig.page.updateSongSettingsPopover()
    })

    it('offer the pad sets where the media player is, and say so when they cannot be listed', async () => {
      await rig.open()
      rig.page.showSong(0, true)
      localStorage.removeItem('media-settings')
      rig.page.updateSongSettingsPopover()
      await wait(50)
      expect(popover().mediaAvailable).to.be.a('boolean')
    })

    it('can be reset after asking, and are left alone when not confirmed', async () => {
      await rig.open()
      rig.page.showSong(0, true)
      let resets = 0
      rig.page.resetCurrentSong = async () => {
        resets++
      }
      const modal = must($<AppModal>('#reset-confirm-modal'))
      modal.ask = async () => false
      popover().dispatchEvent(new SongResetClickEvent())
      await wait(30)
      expect(resets).to.equal(0)
      modal.ask = async () => true
      popover().dispatchEvent(new SongResetClickEvent())
      await wait(30)
      expect(resets).to.equal(1)
    })
  })

  describe('resetting a song', () => {
    it('puts back the key, tempo, font size, capo and sections', async () => {
      setCapoPreference(true)
      await rig.open()
      rig.page.showSong(0, true)
      await rig.page.handleKeyChange('A')
      await rig.page.handleBPMChange(120)
      await rig.page.handleCapoChange(3)
      rig.page.sections.states = {
        0: { 0: { hideMode: 'hide', isCollapsed: false, isHidden: true } },
      }
      rig.page.songs[0].currentFontSize = 2.5
      await rig.page.resetCurrentSong()
      expect(rig.page.songs[0].currentKey).to.equal('G')
      expect(rig.page.songs[0].currentBPM).to.equal(90)
      expect(rig.page.songs[0].currentCapo).to.equal(0)
      expect(rig.page.songs[0].currentFontSize).to.equal(1.6)
      expect(rig.page.sections.states[0]).to.equal(undefined)
    })

    it('shows the key again when it was right already', async () => {
      await rig.open()
      rig.page.showSong(0, true)
      await rig.page.resetCurrentSong()
      expect(($('#musical-metadata') as unknown as { keyValue: string }).keyValue).to.equal('G')
    })

    it('resets the tempo of a user who can only read too, and notes a song with no original key', async () => {
      await rig.open()
      rig.page.showSong(0, true)
      await setReadOnly()
      rig.page.songs[0].currentBPM = 111
      await rig.page.resetCurrentSong()
      expect(rig.page.songs[0].currentBPM).to.equal(rig.page.songs[0].metadata.tempo)
      rig.page.songs[0].originalKey = null
      await rig.page.resetCurrentSong()
    })

    it('does nothing with no song', async () => {
      await rig.open()
      await rig.page.resetCurrentSong()
    })
  })

  describe('drawing a song again', () => {
    it('gives the tempo from the setlist, and the time from the chart, as a note', async () => {
      await rig.open()
      const setlist = must(rig.page.currentSetlist)
      setlist.songs[0].tempo = 110
      rig.page.songs[0].sourceText = chartOf('Alpha', 'G', 90).replace('{time: 4/4}', '{time: 6/8}')
      await rig.page.reRenderSong(0)
      expect(rig.page.songs[0].currentBPM).to.equal(110)
      expect(rig.page.songs[0].metadata.tempoNote).to.equal('1/8')
      expect(rig.page.songs[0].metadata.timeSignature).to.equal('6/8')
    })

    it('takes a quarter note when there is no time, and the chart’s tempo when the setlist has none', async () => {
      await rig.open()
      must(rig.page.currentSetlist).songs[0].tempo = null
      rig.page.songs[0].sourceText = '{title: Alpha}\n{key: G}\n{tempo: 70 (1/2)}\n\n[G]Words'
      await rig.page.reRenderSong(0)
      expect(rig.page.songs[0].metadata.tempoNote).to.equal('1/2')
      expect(rig.page.songs[0].currentBPM).to.equal(70)
    })

    it('redraws the header when it is the song being viewed', async () => {
      await rig.open()
      rig.page.showSong(0, true)
      await rig.page.reRenderSong(0)
      expect(($('#app-header') as unknown as { heading: string }).heading).to.equal('Alpha')
    })

    it('is not needed for a song with no entry, or a section that is not there', async () => {
      await rig.open()
      must(rig.page.currentSetlist).songs[1] = undefined as never
      await rig.page.reRenderSong(1)
      rig.root.querySelector('#song-2')?.remove()
      await rig.page.reRenderSong(2)
    })
  })

  describe('the font', () => {
    it('is that of the song, applied to its section', async () => {
      await rig.open()
      rig.page.songs[1].currentFontSize = 2
      rig.page.applyFontSize(1)
      expect(($('#song-1 .song-content') as HTMLElement).style.fontSize).to.equal('2rem')
      rig.page.applyFontSize(-1)
      rig.page.applyFontSize(9)
      rig.root.querySelector('#song-1')?.remove()
      rig.page.applyFontSize(1)
    })
  })

  describe('songs in the setlist', () => {
    it('are added with their key and tempo, and the setlist shown again', async () => {
      const setlist = await rig.open(2)
      const song = await rig.saveSong('Echo', 'E', 100)
      const { getSongWithContent } = await import('../src/js/song-utils.ts')
      await rig.page.addSongToSetlist(await getSongWithContent(song.uuid, rig.db))
      expect(must(await rig.db.getSetlist(setlist.id)).songs).to.have.length(3)
    })

    it('are not added to no setlist, and are not deleted from none', async () => {
      await rig.open()
      rig.page.currentSetlist = undefined
      await rig.page.addSongToSetlist({} as never)
      await rig.page.deleteSongFromSetlist(0)
      await rig.page.changeSongKeyInSetlist(0, 'A')
      await rig.page.changeSongBpmInSetlist(0, 90)
    })

    it('are deleted after asking, and left when not', async () => {
      const setlist = await rig.open()
      const modal = must($<AppModal>('#delete-song-modal'))
      modal.ask = async () => true
      await rig.page.showDeleteSongConfirmation(0, rig.page.songs[0])
      expect(must(await rig.db.getSetlist(setlist.id)).songs).to.have.length(2)
      modal.ask = async () => false
      await rig.page.showDeleteSongConfirmation(0, rig.page.songs[0])
      expect(must(await rig.db.getSetlist(setlist.id)).songs).to.have.length(2)
    })
  })
})
