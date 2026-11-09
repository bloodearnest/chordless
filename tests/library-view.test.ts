/**
 * The library view with a song open: what its sections do, changing the key, and what edit mode
 * saves and the reset puts back. (The list, searching, and the view leaving nothing behind are in
 * song-filter.test.ts, view-teardown.test.ts and the Playwright tests.)
 */

import { expect, waitUntil } from '@open-wc/testing'
import type { AppHeader } from '../src/components/app-header.ts'
import type { AppModal } from '../src/components/app-modal.ts'
import { KeyChangeEvent, type KeySelector } from '../src/components/key-selector.ts'
import type { ScoreView } from '../src/components/score-view.ts'
import { SongRangeChangedEvent } from '../src/components/song-info-dialog.ts'
import {
  SectionActionEvent,
  SectionToggleEvent,
  type SongSection,
} from '../src/components/song-section.ts'
import { type ChordlessDB, getCurrentDB } from '../src/js/db.ts'
import { setRouter } from '../src/js/navigation.ts'
import { getSongUserPrefs } from '../src/js/song-user-prefs.ts'
import { sampleRecord } from './score-sample.ts'
import '../src/js/views/library-view.ts'
import type { LibraryView } from '../src/js/views/library-view.ts'
import { makeSong } from './builders.ts'
import { must } from './must.ts'
import { nothingFor, settle, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, before, beforeEach, afterEach } = window

suppressConsoleLogs()

const CHART = `{title: Library Test Song}
{key: G}
{tempo: 90}

{comment: Verse 1}
[G]Amazing [C]grace

{comment: Chorus}
[D]How sweet the [G]sound

{comment: Bridge}
[Em]I once was [D]lost`

describe('the library view, with a song open', () => {
  let db: ChordlessDB
  let song: { uuid: string; id: string }
  let keyless: { uuid: string; id: string }
  let unrecorded: { uuid: string; id: string }
  let outlet: HTMLElement
  let view: LibraryView

  /** The sections of the open song, in the song display's shadow DOM */
  const sections = () =>
    Array.from(
      view
        .querySelector('song-display')
        ?.shadowRoot?.querySelectorAll<SongSection>('song-section') ?? []
    )
  const section = (index: number) => must(sections()[index])
  const control = <T extends HTMLElement>(id: string) => must(view.querySelector<T>(`#${id}`))
  const prefs = () => getSongUserPrefs(song.id, db.spaceId)

  /** Wait for something the view does a step after the last thing awaited */
  const until = (condition: () => unknown, what: string) =>
    waitUntil(condition, what, { interval: 20, timeout: 1500 })

  async function open(uuid = song.uuid) {
    view = document.createElement('library-view')
    view.route = { name: 'songs', songUuid: uuid }
    outlet.append(view)
    await until(() => sections().length === 3, 'the song to be shown')
  }

  /** Turn edit mode on or off the way its button does */
  const toggleEditMode = () =>
    control<AppHeader>('library-app-header').dispatchEvent(
      new CustomEvent('app-header:edit-mode-toggle')
    )

  before(async () => {
    db = await getCurrentDB()
    const id = crypto.randomUUID()
    song = { uuid: `song-${id}`, id: `title-library-view-${id}` }
    await db.saveChordPro({
      id: `chordpro-${id}`,
      content: CHART,
      contentHash: id,
      lastModified: Date.now(),
    })
    await db.saveSong(
      makeSong({
        uuid: song.uuid,
        id: song.id,
        title: 'Library Test Song',
        titleNormalized: 'librarytestsong',
        chordproFileId: `chordpro-${id}`,
        key: 'G',
        originalKey: 'G',
      })
    )
    const keylessId = crypto.randomUUID()
    keyless = { uuid: `song-${keylessId}`, id: `title-library-view-${keylessId}` }
    await db.saveChordPro({
      id: `chordpro-${keylessId}`,
      content:
        '{title: No Key Song}\n\n{comment: Verse}\nJust words\n\n{comment: Chorus}\nMore words\n\n{comment: Bridge}\nLast words',
      contentHash: keylessId,
      lastModified: Date.now(),
    })
    await db.saveSong(
      makeSong({
        uuid: keyless.uuid,
        id: keyless.id,
        title: 'No Key Song',
        titleNormalized: 'nokeysong',
        chordproFileId: `chordpro-${keylessId}`,
        key: '',
        originalKey: '',
      })
    )
    const unrecordedId = crypto.randomUUID()
    unrecorded = { uuid: `song-${unrecordedId}`, id: `title-library-view-${unrecordedId}` }
    await db.saveChordPro({
      id: `chordpro-${unrecordedId}`,
      content: CHART.replace('Library Test Song', 'Unrecorded Key').replace('{key: G}', '{key: D}'),
      contentHash: unrecordedId,
      lastModified: Date.now(),
    })
    await db.saveSong(
      makeSong({
        uuid: unrecorded.uuid,
        id: unrecorded.id,
        title: 'Unrecorded Key',
        titleNormalized: 'unrecordedkey',
        chordproFileId: `chordpro-${unrecordedId}`,
        key: 'D',
        originalKey: '',
      })
    )
  })

  beforeEach(() => {
    // Without a router, goTo() would load a page: and so end the test run
    setRouter({ navigate: async () => true })
    outlet = document.createElement('div')
    document.body.append(outlet)
  })

  afterEach(() => {
    view?.remove()
    outlet.remove()
    setRouter(null)
    localStorage.removeItem(`song-prefs-${db.spaceId}`)
  })

  describe('a section', () => {
    const act = (index: number, action: string) =>
      section(index).dispatchEvent(new SectionActionEvent(0, index, action))

    it('shows chords only, lyrics only, or both, as it is told', async () => {
      await open()

      act(0, 'show-lyrics')
      expect(section(0).hideMode).to.equal('chords')
      act(0, 'show-chords')
      expect(section(0).hideMode).to.equal('lyrics')
      act(0, 'show-all')
      expect(section(0).hideMode).to.equal('none')
      expect(section(1).hideMode, 'the others are left as they were').to.equal('none')
    })

    it('can be hidden outright, which shows it again when it is shown in any way', async () => {
      await open()

      act(1, 'show-none')
      expect(section(1).isHidden).to.equal(true)
      expect(section(1).hideMode).to.equal('hide')

      act(1, 'show-lyrics')
      expect(section(1).isHidden).to.equal(false)
      expect(section(1).hideMode).to.equal('chords')
    })

    it('is hidden, and shown again, by the hide action', async () => {
      await open()

      act(2, 'hide')
      expect(section(2).isHidden).to.equal(true)
      expect(section(2).hideMode).to.equal('hide')

      act(2, 'hide')
      expect(section(2).isHidden).to.equal(false)
    })

    it('is collapsed, and opened again, by the collapse action', async () => {
      await open()
      const details = must(section(0).getDetailsElement())
      expect(details.open).to.equal(true)

      act(0, 'collapse')
      expect(section(0).isCollapsed).to.equal(true)
      expect(details.open).to.equal(false)

      act(0, 'collapse')
      expect(section(0).isCollapsed).to.equal(false)
      expect(details.open).to.equal(true)
    })

    it('is collapsed, and opened again, by its toggle', async () => {
      await open()

      section(1).dispatchEvent(new SectionToggleEvent(0, 1))
      expect(section(1).isCollapsed).to.equal(true)

      section(1).dispatchEvent(new SectionToggleEvent(0, 1))
      expect(section(1).isCollapsed).to.equal(false)
    })

    it('ignores an action for a section that is not there', async () => {
      await open()
      const before = sections().map(s => [s.hideMode, s.isHidden, s.isCollapsed])

      section(0).dispatchEvent(new SectionActionEvent(0, 9, 'show-none'))
      section(0).dispatchEvent(new SectionToggleEvent(0, 9))

      expect(sections().map(s => [s.hideMode, s.isHidden, s.isCollapsed])).to.deep.equal(before)
    })
  })

  describe('the key', () => {
    const keyOf = () =>
      view.querySelector<HTMLElement & { parsed: { metadata: { key: string } } }>('song-display')
        ?.parsed.metadata.key

    it('transposes the song to the key chosen', async () => {
      await open()

      control<KeySelector>('library-key-selector').dispatchEvent(new KeyChangeEvent('A'))
      await until(() => keyOf() === 'A', 'the song to be shown in A')

      await until(
        () => control<KeySelector>('library-key-selector').value === 'A',
        'the key selector to show A'
      )
      // The chords moved up a tone: G to A
      const text = JSON.stringify(
        view.querySelector<HTMLElement & { parsed: unknown }>('song-display')?.parsed
      )
      expect(text).to.contain('"A"')
    })

    describe('the melody sheet', () => {
      const header = () => control<AppHeader>('library-app-header')
      const toggle = () => header().shadowRoot?.querySelector<HTMLButtonElement>('.melody-toggle')
      const sheet = () => view.querySelector<ScoreView>('score-view')
      const lyrics = () => view.querySelector<HTMLElement>('song-display')
      const visited: { url: string; replace?: boolean }[] = []

      beforeEach(async () => {
        visited.length = 0
        setRouter({
          navigate: async (url: string, options?: { replace?: boolean }) => {
            visited.push({ url, replace: options?.replace })
            return true
          },
        })
        await db.saveScore(sampleRecord(song.uuid, 'G'))
      })
      afterEach(async () => {
        await db.deleteScore(song.uuid, { remember: false })
      })

      it('has a button for a song with a melody, which shows the sheet in place of the lyrics and back', async () => {
        await open()
        await until(() => toggle(), 'the melody button')
        expect(toggle()?.getAttribute('aria-pressed')).to.equal('false')
        expect(sheet()).to.equal(null)

        toggle()?.click()
        await until(() => sheet(), 'the melody sheet')
        expect(sheet()?.hidden).to.equal(false)
        expect(lyrics()?.style.display).to.equal('none')
        expect(visited.at(-1)).to.deep.equal({ url: `/songs/${song.uuid}?melody`, replace: true })
        expect(toggle()?.getAttribute('aria-pressed')).to.equal('true')

        toggle()?.click()
        await until(() => sheet()?.hidden, 'the sheet to be put away')
        expect(lyrics()?.style.display).to.equal('')
        expect(visited.at(-1)).to.deep.equal({ url: `/songs/${song.uuid}`, replace: true })
      })

      it('is shown in the key the song is in, and engraved again for a new one', async () => {
        await open()
        await until(() => toggle(), 'the melody button')
        toggle()?.click()
        await until(() => sheet(), 'the melody sheet')
        expect(sheet()?.songKey).to.equal('G')
        control<KeySelector>('library-key-selector').dispatchEvent(new KeyChangeEvent('A'))
        await until(() => sheet()?.songKey === 'A', 'the sheet in A')
        expect(lyrics()?.style.display).to.equal('none')
      })

      it('follows the route: opened as the sheet, and moved to the lyrics and back by a link or Back', async () => {
        view = document.createElement('library-view')
        view.route = { name: 'songs', songUuid: song.uuid, melody: true }
        outlet.append(view)
        await until(() => sheet(), 'the song to open as its sheet')
        expect(toggle()?.getAttribute('aria-pressed')).to.equal('true')
        view.route = { name: 'songs', songUuid: song.uuid }
        await until(() => sheet()?.hidden, 'the lyrics to come back')
        view.route = { name: 'songs', songUuid: song.uuid, melody: true }
        await until(() => sheet() && !sheet()?.hidden, 'the sheet to come back')
      })

      it('has no button for a song with no melody, and none once the song is closed', async () => {
        await db.deleteScore(song.uuid, { remember: false })
        await open()
        await nothingFor()
        expect(toggle() ?? null).to.equal(null)
        await db.saveScore(sampleRecord(song.uuid, 'G'))
        view.route = { name: 'songs' }
        await nothingFor()
        expect(toggle() ?? null).to.equal(null)
      })
    })

    describe('the melody range', () => {
      const infoDialog = () => control('library-song-info-dialog')
      const selector = () => control<KeySelector>('library-key-selector')

      it('is given to the key picker, and the new one when the info dialog sets it', async () => {
        await open()
        expect(selector().range).to.equal(null)
        infoDialog().dispatchEvent(new SongRangeChangedEvent(song.id, 'D4-E5'))
        expect(selector().range).to.deep.equal({ low: 62, high: 76 })
        // (in the chart's key, whatever key the song is shown in)
        expect(selector().rangeKey).to.equal('G')
        infoDialog().dispatchEvent(new SongRangeChangedEvent(song.id, null))
        expect(selector().range).to.equal(null)
      })

      it('comes from the song’s melody when the chart has no range of its own', async () => {
        await db.saveScore(sampleRecord(song.uuid, 'G'))
        try {
          await open()
          await until(() => selector().range, 'the melody’s range')
          expect(selector().range).to.deep.equal({ low: 60, high: 67 })
          expect(selector().rangeKey).to.equal('G')
        } finally {
          await db.deleteScore(song.uuid, { remember: false })
        }
      })

      it('is left alone when it is another song’s, or no song is open', async () => {
        await open()
        infoDialog().dispatchEvent(new SongRangeChangedEvent('title-another-song', 'D4-E5'))
        expect(selector().range).to.equal(null)

        view.remove()
        view = document.createElement('library-view')
        view.route = { name: 'songs' }
        outlet.append(view)
        await view.updateComplete
        infoDialog().dispatchEvent(new SongRangeChangedEvent(song.id, 'D4-E5'))
      })

      it('does not light up a picker for a song with no key to measure from', async () => {
        await open(keyless.uuid)
        infoDialog().dispatchEvent(new SongRangeChangedEvent(keyless.id, 'D4-E5'))
        expect(selector().range).to.equal(null)
      })
    })

    it('keeps the sections as the user has set them', async () => {
      await open()
      toggleEditMode()
      section(1).dispatchEvent(new SectionActionEvent(0, 1, 'show-lyrics'))
      section(2).dispatchEvent(new SectionActionEvent(0, 2, 'show-none'))

      control<KeySelector>('library-key-selector').dispatchEvent(new KeyChangeEvent('A'))
      await until(() => keyOf() === 'A', 'the song to be shown in A')
      await until(() => sections()[2]?.isHidden, 'the sections as they were set')

      expect(sections().map(s => [s.hideMode, s.isHidden])).to.deep.equal([
        ['none', false],
        ['chords', false],
        ['hide', true],
      ])
    })

    it('does not change the song in the library until edit mode is left', async () => {
      await open()

      control<KeySelector>('library-key-selector').dispatchEvent(new KeyChangeEvent('A'))
      await until(() => keyOf() === 'A', 'the song to be shown in A')

      expect(must(await db.getSong(song.uuid)).key).to.equal('G')
    })
  })

  describe('edit mode', () => {
    it('is on <body>, and goes when the view does', async () => {
      await open()
      toggleEditMode()
      expect(document.body.classList.contains('edit-mode')).to.equal(true)
      expect(sections().every(s => s.editMode)).to.equal(true)

      view.remove()
      expect(document.body.classList.contains('edit-mode')).to.equal(false)
    })

    it('saves the key and the sections the user set when it is left', async () => {
      await open()
      toggleEditMode()
      section(1).dispatchEvent(new SectionActionEvent(0, 1, 'show-lyrics'))
      section(2).dispatchEvent(new SectionActionEvent(0, 2, 'show-none'))
      control<KeySelector>('library-key-selector').dispatchEvent(new KeyChangeEvent('A'))
      await until(
        () =>
          view.querySelector<HTMLElement & { parsed: { metadata: { key: string } } }>(
            'song-display'
          )?.parsed.metadata.key === 'A',
        'the song in A'
      )
      // (the song is drawn again in A, and its sections are put back as they were set)
      await until(() => sections()[2]?.isHidden, 'the sections as they were set')

      toggleEditMode()
      await until(() => prefs()?.sectionDefaults, 'the sections to be saved')
      await until(async () => (await db.getSong(song.uuid))?.key === 'A', 'the key to be saved')

      expect(prefs()?.sectionDefaults).to.deep.equal({
        1: { hideMode: 'chords', isCollapsed: false, isHidden: false },
        2: { hideMode: 'hide', isCollapsed: false, isHidden: true },
      })
    })

    it('shows the sections it saved the next time the song is opened', async () => {
      await open()
      toggleEditMode()
      section(1).dispatchEvent(new SectionActionEvent(0, 1, 'show-lyrics'))
      toggleEditMode()
      await until(() => prefs()?.sectionDefaults, 'the sections to be saved')
      view.remove()

      await open()

      expect(section(0).hideMode).to.equal('none')
      expect(section(1).hideMode).to.equal('chords')
    })
  })

  describe('reset', () => {
    async function answer(confirm: boolean) {
      const modal = control<AppModal>('library-reset-confirm-modal')
      await until(() => modal.open, 'the question to be asked')
      await modal.updateComplete
      const button = modal.shadowRoot?.querySelector<HTMLElement>(
        confirm ? '.modal-btn-confirm' : '.modal-btn-cancel'
      )
      must(button).click()
    }

    it('puts the key back to the one the song came in, after asking', async () => {
      await open()
      toggleEditMode()
      control<KeySelector>('library-key-selector').dispatchEvent(new KeyChangeEvent('A'))
      await until(
        () =>
          view.querySelector<HTMLElement & { parsed: { metadata: { key: string } } }>(
            'song-display'
          )?.parsed.metadata.key === 'A',
        'the song to be shown in A'
      )

      control('library-reset-button').click()
      await answer(true)

      await until(
        () =>
          view.querySelector<HTMLElement & { parsed: { metadata: { key: string } } }>(
            'song-display'
          )?.parsed.metadata.key === 'G',
        'the song to be shown in G again'
      )
      // (the selector is drawn from its own update: waiting for the song does not wait for it)
      await until(
        () => control<KeySelector>('library-key-selector').value === 'G',
        'the key selector to show G again'
      )
    })

    it('puts the sections back to how they start, in the page and as saved', async () => {
      await open()
      toggleEditMode()
      section(1).dispatchEvent(new SectionActionEvent(0, 1, 'show-lyrics'))
      toggleEditMode()
      await until(() => prefs()?.sectionDefaults, 'the sections to be saved')
      toggleEditMode()

      control('library-reset-button').click()
      await answer(true)

      await until(() => sections()[1]?.hideMode === 'none', 'the section to be shown as it starts')
      await until(() => prefs()?.sectionDefaults === undefined, 'the saved sections to go')
    })

    it('changes nothing when it is not confirmed', async () => {
      await open()
      toggleEditMode()
      control<KeySelector>('library-key-selector').dispatchEvent(new KeyChangeEvent('A'))
      await until(
        () =>
          view.querySelector<HTMLElement & { parsed: { metadata: { key: string } } }>(
            'song-display'
          )?.parsed.metadata.key === 'A',
        'the song to be shown in A'
      )

      control('library-reset-button').click()
      await answer(false)
      await nothingFor()

      expect(
        view.querySelector<HTMLElement & { parsed: { metadata: { key: string } } }>('song-display')
          ?.parsed.metadata.key
      ).to.equal('A')
    })
  })

  describe('corners', () => {
    it('ignores a key change with no key', async () => {
      await open()
      control<KeySelector>('library-key-selector').dispatchEvent(new KeyChangeEvent(''))
      await nothingFor()
      expect(
        view.querySelector<HTMLElement & { parsed: { metadata: { key: string } } }>('song-display')
          ?.parsed.metadata.key
      ).to.equal('G')
    })

    it('has nothing to save when edit mode is left with no song open', async () => {
      view = document.createElement('library-view')
      view.route = { name: 'songs' }
      outlet.append(view)
      await view.updateComplete
      toggleEditMode()
      toggleEditMode()
      expect(document.body.classList.contains('edit-mode')).to.equal(false)
    })

    it('goes on when what it saves cannot be: the edit is left', async () => {
      await open()
      toggleEditMode()
      control<KeySelector>('library-key-selector').dispatchEvent(new KeyChangeEvent('A'))
      await until(
        () =>
          view.querySelector<HTMLElement & { parsed: { metadata: { key: string } } }>(
            'song-display'
          )?.parsed.metadata.key === 'A',
        'the song in A'
      )
      const real = db.constructor.prototype.updateSong
      let tried = false
      db.constructor.prototype.updateSong = async () => {
        tried = true
        throw new Error('disk full')
      }
      try {
        toggleEditMode()
        await until(() => tried, 'the song to be saved')
        await settle()
      } finally {
        db.constructor.prototype.updateSong = real
      }
      expect(document.body.classList.contains('edit-mode')).to.equal(false)
    })

    it('shows and resets a song with no key', async () => {
      await open(keyless.uuid)
      toggleEditMode()
      control('library-reset-button').click()
      const modal = control<AppModal>('library-reset-confirm-modal')
      await until(() => modal.open, 'the question to be asked')
      await modal.updateComplete
      must(modal.shadowRoot?.querySelector<HTMLElement>('.modal-btn-confirm')).click()
      await until(() => !modal.open, 'the question to be answered')
      await until(() => sections().length === 3, 'the song to be shown again')
      expect(sections()).to.have.length(3)
    })

    it('takes the chart’s key as the original when the song has none recorded', async () => {
      await open(unrecorded.uuid)
      expect(control<KeySelector>('library-key-selector').originalKey).to.equal('D')
      toggleEditMode()
      control('library-reset-button').click()
      const modal = control<AppModal>('library-reset-confirm-modal')
      await until(() => modal.open, 'the question to be asked')
      await modal.updateComplete
      must(modal.shadowRoot?.querySelector<HTMLElement>('.modal-btn-confirm')).click()
      await until(
        () => control<KeySelector>('library-key-selector').value === 'D',
        'the key to be the original'
      )
    })

    it('does nothing when the song is closed while the reset is being asked', async () => {
      await open()
      toggleEditMode()
      control<KeySelector>('library-key-selector').dispatchEvent(new KeyChangeEvent('A'))
      await until(
        () =>
          view.querySelector<HTMLElement & { parsed: { metadata: { key: string } } }>(
            'song-display'
          )?.parsed.metadata.key === 'A',
        'the song in A'
      )
      control('library-reset-button').click()
      const modal = control<AppModal>('library-reset-confirm-modal')
      await until(() => modal.open, 'the question to be asked')
      view.route = { name: 'songs' }
      await until(() => !document.body.classList.contains('edit-mode'), 'the song to be closed')
      await modal.updateComplete
      must(modal.shadowRoot?.querySelector<HTMLElement>('.modal-btn-confirm')).click()
      await nothingFor()
      expect(control<KeySelector>('library-key-selector').value).to.equal('A')
    })
  })
})
