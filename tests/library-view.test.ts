/**
 * The library view with a song open: what its sections do, changing the key, and what edit mode
 * saves and the reset puts back. (The list, searching, and the view leaving nothing behind are in
 * song-filter.test.ts, view-teardown.test.ts and the Playwright tests.)
 */

import { expect } from '@open-wc/testing'
import type { AppHeader } from '../src/components/app-header.ts'
import type { AppModal } from '../src/components/app-modal.ts'
import { KeyChangeEvent, type KeySelector } from '../src/components/key-selector.ts'
import {
  SectionActionEvent,
  SectionToggleEvent,
  type SongSection,
} from '../src/components/song-section.ts'
import { type ChordlessDB, getCurrentDB } from '../src/js/db.ts'
import { setRouter } from '../src/js/navigation.ts'
import { getSongUserPrefs } from '../src/js/song-user-prefs.ts'
import '../src/js/views/library-view.ts'
import type { LibraryView } from '../src/js/views/library-view.ts'
import { makeSong } from './builders.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

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
  async function until(condition: () => unknown, what: string) {
    for (let i = 0; i < 100 && !condition(); i++) await wait(20)
    expect(condition(), what).to.be.ok
  }

  async function open(uuid = song.uuid) {
    view = document.createElement('library-view')
    view.route = { name: 'songs', songUuid: uuid }
    outlet.append(view)
    await until(() => sections().length === 3, 'the song to be shown')
    await wait(50)
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

    it('keeps the sections as the user has set them', async () => {
      await open()
      toggleEditMode()
      section(1).dispatchEvent(new SectionActionEvent(0, 1, 'show-lyrics'))
      section(2).dispatchEvent(new SectionActionEvent(0, 2, 'show-none'))

      control<KeySelector>('library-key-selector').dispatchEvent(new KeyChangeEvent('A'))
      await until(() => keyOf() === 'A', 'the song to be shown in A')
      await wait(100)

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
      await until(() => view.querySelector('song-display'), 'the song')
      await wait(100)

      toggleEditMode()
      await until(() => prefs()?.sectionDefaults, 'the sections to be saved')
      await wait(100)
      expect(must(await db.getSong(song.uuid)).key).to.equal('A')

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
      expect(control<KeySelector>('library-key-selector').value).to.equal('G')
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
      await wait(100)
      expect(prefs()?.sectionDefaults).to.equal(undefined)
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
      await wait(100)

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
      await wait(50)
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
      await wait(100)
      const real = db.constructor.prototype.updateSong
      db.constructor.prototype.updateSong = async () => {
        throw new Error('disk full')
      }
      try {
        toggleEditMode()
        await wait(200)
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
      await wait(200)
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
      await wait(200)
      expect(control<KeySelector>('library-key-selector').value).to.equal('D')
    })

    it('does nothing when the song is closed while the reset is being asked', async () => {
      await open()
      toggleEditMode()
      control<KeySelector>('library-key-selector').dispatchEvent(new KeyChangeEvent('A'))
      await wait(100)
      control('library-reset-button').click()
      const modal = control<AppModal>('library-reset-confirm-modal')
      await until(() => modal.open, 'the question to be asked')
      view.route = { name: 'songs' }
      await wait(100)
      await modal.updateComplete
      must(modal.shadowRoot?.querySelector<HTMLElement>('.modal-btn-confirm')).click()
      await wait(100)
      expect(control<KeySelector>('library-key-selector').value).to.equal('A')
    })
  })
})
