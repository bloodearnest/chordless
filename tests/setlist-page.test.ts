/**
 * The setlist page's own logic: reordering, adding and removing songs, re-rendering after an
 * edit, a song's media preferences and the capo preference. (The views leaving nothing behind is
 * view-teardown.test.ts; what a user does across the whole app is in the Playwright tests.)
 *
 * The page is started on the elements the setlist view gives it, against a setlist saved in the
 * organisation's database under a name of its own.
 */

import { expect } from '@open-wc/testing'
import { render } from 'lit'
import type { SongDisplay } from '../src/components/song-display.ts'
import '../src/components/song-display.ts'
import '../src/components/song-section.ts'
import { CapoChangeEvent } from '../src/components/capo-selector.ts'
import { SongChangeEvent } from '../src/js/app-events.ts'
import type { Setlist, SongWithContent } from '../src/js/data-types.ts'
import { type ChordlessDB, getCurrentDB } from '../src/js/db.ts'
import { setRouter } from '../src/js/navigation.ts'
import { CapoPreferenceEvent, setCapoPreference } from '../src/js/preferences.ts'
import { loadSetlistLocalState, saveSetlistLocalState } from '../src/js/setlist/local-state.ts'
import { SetlistPage } from '../src/js/setlist-page.ts'
import { getSongUserPrefs } from '../src/js/song-user-prefs.ts'
import { setlistTemplate } from '../src/js/views/setlist-view.ts'
import { makeEntry, makeSetlist, makeSong } from './builders.ts'
import { must } from './must.ts'
import { clearToasts, settle, shownToast, suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, before, beforeEach, afterEach } = window

suppressConsoleLogs()

const chart = (title: string, key: string) =>
  `{title: ${title}}\n{key: ${key}}\n{tempo: 90}\n\n{comment: Verse 1}\n[${key}]Amazing [C]grace`

describe('the setlist page', () => {
  let db: ChordlessDB
  let run: string
  let songs: { uuid: string; id: string; title: string }[]
  let root: HTMLElement
  let page: SetlistPage
  let realError: typeof console.error
  let errors: unknown[][]

  /** Save a song (and its chart) to the library */
  async function saveSong(title: string, key = 'G') {
    const id = crypto.randomUUID()
    const song = { uuid: `song-${id}`, id: `title-${run}-${title}`, title }
    await db.saveChordPro({
      id: `chordpro-${id}`,
      content: chart(title, key),
      contentHash: id,
      lastModified: Date.now(),
    })
    await db.saveSong(
      makeSong({
        uuid: song.uuid,
        id: song.id,
        title,
        titleNormalized: title.toLowerCase(),
        chordproFileId: `chordpro-${id}`,
        key,
        originalKey: key,
        tempo: 90,
        originalTempo: 90,
      })
    )
    return song
  }

  /** Save a setlist of the first `count` songs, and start the page on it */
  async function open(count = 3, overrides: Partial<Setlist> = {}) {
    const setlist = makeSetlist({
      id: `setlist-${crypto.randomUUID()}`,
      songs: songs
        .slice(0, count)
        .map((song, order) =>
          makeEntry({ order, songId: song.id, songUuid: song.uuid, key: 'G', tempo: 90 })
        ),
      ...overrides,
    })
    await db.saveSetlist(setlist)
    page = new SetlistPage({ root, setlistId: setlist.id, db })
    await page.start()
    // The page finishes setting up (selectors, the observer of the song in view) in the next frame
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    return setlist
  }

  /** Wait for something to come true (the page saves in the background) */
  async function until(check: () => Promise<boolean>) {
    for (let i = 0; i < 100 && !(await check()); i++) await wait(20)
  }

  const titles = (list: { title: string }[]) => list.map(song => song.title)
  const savedTitles = async (id: string) => {
    const saved = must(await db.getSetlist(id))
    return saved.songs.map(entry => must(songs.find(song => song.uuid === entry.songUuid)).title)
  }
  /** The ids of the song sections, in the page's order */
  const titleIn = (selector: string) =>
    must(root.querySelector<SongDisplay>(`${selector} song-display`)).parsed?.metadata.title
  const sectionIds = () =>
    Array.from(root.querySelectorAll('.section[id^="song-"]'), section => section.id)

  before(async () => {
    db = await getCurrentDB()
    run = crypto.randomUUID()
    songs = [
      await saveSong('Alpha'),
      await saveSong('Bravo'),
      await saveSong('Charlie'),
      await saveSong('Delta', 'D'),
    ]
  })

  beforeEach(() => {
    // Without a router, goTo() would load a page: and so end the test run
    setRouter({ navigate: async () => true })
    localStorage.removeItem('enabled_capo')
    setCapoPreference(false)
    root = document.createElement('div')
    document.body.append(root)
    render(setlistTemplate({ editable: true }), root)
    errors = []
    realError = console.error
    console.error = (...args: unknown[]) => {
      errors.push(args)
    }
  })

  afterEach(() => {
    page?.dispose()
    setRouter(null)
    root.remove()
    clearToasts()
    console.error = realError
    setCapoPreference(false)
    document.body.classList.remove('edit-mode')
  })

  describe('reordering songs', () => {
    it('moves a song down: in the page, in the DOM, and in the saved setlist', async () => {
      const setlist = await open()

      await page.moveSong(0, 2)

      expect(titles(page.songs)).to.deep.equal(['Bravo', 'Charlie', 'Alpha'])
      expect(await savedTitles(setlist.id)).to.deep.equal(['Bravo', 'Charlie', 'Alpha'])
      const saved = must(await db.getSetlist(setlist.id))
      expect(saved.songs.map(entry => entry.order)).to.deep.equal([0, 1, 2])
      expect(sectionIds()).to.deep.equal(['song-0', 'song-1', 'song-2'])
      // The first section now holds the song that was moved up into it
      expect(titleIn('#song-0')).to.equal('Bravo')
      expect(titleIn('#song-2')).to.equal('Alpha')
    })

    it('moves a song up to the front', async () => {
      const setlist = await open()

      await page.moveSong(2, 0)

      expect(titles(page.songs)).to.deep.equal(['Charlie', 'Alpha', 'Bravo'])
      expect(await savedTitles(setlist.id)).to.deep.equal(['Charlie', 'Alpha', 'Bravo'])
      expect(titleIn('#song-0')).to.equal('Charlie')
    })

    it('moves a song one place', async () => {
      const setlist = await open()

      await page.moveSong(1, 2)

      expect(await savedTitles(setlist.id)).to.deep.equal(['Alpha', 'Charlie', 'Bravo'])
      expect(titleIn('#song-1')).to.equal('Charlie')
    })

    it('numbers the data-song-index of everything in a moved section to its new place', async () => {
      await open()

      await page.moveSong(0, 2)

      for (const [index, section] of root.querySelectorAll('.section[id^="song-"]').entries()) {
        for (const el of section.querySelectorAll<HTMLElement>('[data-song-index]')) {
          expect(el.dataset.songIndex, section.id).to.equal(String(index))
        }
      }
    })

    it('keeps each song display knowing its place, which the capo preference goes by', async () => {
      await open()

      await page.moveSong(0, 2)

      const places = Array.from(
        root.querySelectorAll<SongDisplay>('song-display'),
        d => d.songIndex
      )
      expect(places).to.deep.equal([0, 1, 2])
      expect(page.songs.map(song => song.songIndex)).to.deep.equal([0, 1, 2])
    })

    it('renumbers the sections inside the song displays, which section states are found by', async () => {
      await open()

      await page.moveSong(0, 2)

      for (const [index, display] of root.querySelectorAll('song-display').entries()) {
        const numbers = Array.from(
          display.shadowRoot?.querySelectorAll('song-section') ?? [],
          section => section.getAttribute('song-index')
        )
        expect(numbers.length).to.be.greaterThan(0)
        expect(new Set(numbers), `song ${index}`).to.deep.equal(new Set([String(index)]))
      }
    })

    it('moves the sections shown and hidden with the song, and keeps them', async () => {
      const setlist = await open()
      const hidden = { hideMode: 'none' as const, isCollapsed: true, isHidden: true }
      page.sections.states = { 0: { 0: hidden } }

      await page.moveSong(0, 2)

      expect(page.sections.states).to.deep.equal({ 2: { 0: hidden } })
      expect(loadSetlistLocalState(setlist.id).sectionState).to.deep.equal({ 2: { 0: hidden } })
    })

    it('shifts the states of the songs it passes over by one place', async () => {
      await open()
      const hidden = { hideMode: 'none' as const, isCollapsed: true, isHidden: true }
      page.sections.states = { 1: { 0: hidden } }

      await page.moveSong(2, 0)

      expect(page.sections.states).to.deep.equal({ 2: { 0: hidden } })
    })

    it('changes the setlist modified date', async () => {
      const setlist = await open(3, { modifiedDate: '2020-01-01T00:00:00.000Z' })

      await page.moveSong(0, 1)

      const saved = must(await db.getSetlist(setlist.id))
      expect(saved.modifiedDate > '2020-01-01T00:00:00.000Z').to.equal(true)
    })

    it('does nothing before a setlist is shown', async () => {
      const unstarted = new SetlistPage({ root, setlistId: 'nope', db })
      await unstarted.moveSong(0, 1)
      expect(unstarted.songs).to.deep.equal([])
    })
  })

  describe('adding a song', () => {
    const asLibrarySong = (song: { uuid: string; id: string; title: string }, key = 'G') =>
      ({
        uuid: song.uuid,
        id: song.id,
        title: song.title,
        metadata: { key, tempo: 90 },
      }) as unknown as SongWithContent

    it('adds it at the end with the key and tempo it has now, and shows it', async () => {
      const setlist = await open(2)

      await page.addSongToSetlist(asLibrarySong(songs[3], 'D'))

      const saved = must(await db.getSetlist(setlist.id))
      expect(saved.songs).to.have.length(3)
      expect(saved.songs[2]).to.include({
        order: 2,
        songId: songs[3].id,
        songUuid: songs[3].uuid,
        key: 'D',
        tempo: 90,
        notes: '',
      })
      expect(titles(page.songs)).to.deep.equal(['Alpha', 'Bravo', 'Delta'])
      expect(sectionIds()).to.deep.equal(['song-0', 'song-1', 'song-2'])
    })

    it('says so and keeps what was saved when the save fails', async () => {
      const setlist = await open(2)
      const realSave = db.saveSetlist
      db.saveSetlist = async () => {
        throw new Error('disk full')
      }
      try {
        await page.addSongToSetlist(asLibrarySong(songs[3]))
      } finally {
        db.saveSetlist = realSave
      }

      expect(shownToast()).to.include({
        message: "Couldn't add the song to the setlist.",
        kind: 'error',
        details: 'disk full',
      })
      expect(shownToast()?.action?.label).to.equal('Try again')
      expect(errors.some(args => String(args[0]).includes('Error adding song'))).to.equal(true)
      expect(await savedTitles(setlist.id)).to.deep.equal(['Alpha', 'Bravo'])
    })

    it('adds the song once, not twice, when Try again is pressed after a failed save', async () => {
      const setlist = await open(2)
      const realSave = db.saveSetlist
      db.saveSetlist = async () => {
        throw new Error('disk full')
      }
      try {
        await page.addSongToSetlist(asLibrarySong(songs[3]))
      } finally {
        db.saveSetlist = realSave
      }
      expect(page.currentSetlist?.songs).to.have.length(2)

      must(shownToast()?.action).run()
      await until(async () => (await savedTitles(setlist.id)).length === 3)

      expect(await savedTitles(setlist.id)).to.deep.equal(['Alpha', 'Bravo', 'Delta'])
    })

    it('does nothing, and says so in the log, before a setlist is shown', async () => {
      const unstarted = new SetlistPage({ root, setlistId: 'nope', db })

      await unstarted.addSongToSetlist(asLibrarySong(songs[3]))

      expect(shownToast()).to.equal(null)
      expect(errors.map(args => args[0])).to.deep.equal(['No current setlist'])
    })
  })

  describe('removing a song', () => {
    it('removes it and numbers the rest again', async () => {
      const setlist = await open()

      await page.deleteSongFromSetlist(1)

      expect(await savedTitles(setlist.id)).to.deep.equal(['Alpha', 'Charlie'])
      const saved = must(await db.getSetlist(setlist.id))
      expect(saved.songs.map(entry => entry.order)).to.deep.equal([0, 1])
      expect(titles(page.songs)).to.deep.equal(['Alpha', 'Charlie'])
    })

    it('keeps the sections shown and the capos of the songs after it, which move up', async () => {
      const setlist = await open()
      const hidden = { hideMode: 'none' as const, isCollapsed: true, isHidden: true }
      saveSetlistLocalState(setlist.id, {
        sectionState: { 0: { 0: hidden }, 1: { 0: hidden }, 2: { 1: hidden } },
        capoValues: { 1: 2, 2: 3 },
      })

      await page.deleteSongFromSetlist(1)

      expect(loadSetlistLocalState(setlist.id)).to.deep.equal({
        sectionState: { 0: { 0: hidden }, 1: { 1: hidden } },
        capoValues: { 1: 3 },
      })
    })

    it('says so when the save fails', async () => {
      await open()
      const realSave = db.saveSetlist
      db.saveSetlist = async () => {
        throw new Error('disk full')
      }
      try {
        await page.deleteSongFromSetlist(0)
      } finally {
        db.saveSetlist = realSave
      }
      expect(shownToast()).to.include({
        message: "Couldn't remove the song from the setlist.",
        kind: 'error',
        details: 'disk full',
      })
    })
  })

  describe('a song that fails before anything is changed', () => {
    it('is said so, with nothing to put back, when it cannot be added', async () => {
      const setlist = await open(2)
      const broken = {
        get metadata(): never {
          throw new Error('unreadable chart')
        },
      }

      await page.addSongToSetlist(broken as never)

      expect(shownToast()?.details).to.equal('unreadable chart')
      expect(await savedTitles(setlist.id)).to.deep.equal(['Alpha', 'Bravo'])
    })

    it('is said so, with nothing to put back, when it cannot be removed', async () => {
      await open()
      must(page.currentSetlist).songs.splice = () => {
        throw new Error('frozen')
      }

      await page.deleteSongFromSetlist(0)

      expect(shownToast()?.details).to.equal('frozen')
    })
  })

  describe('removing a song that cannot be saved', () => {
    it('keeps it in place, and Try again removes that song and not the next', async () => {
      const setlist = await open()
      const realSave = db.saveSetlist
      db.saveSetlist = async () => {
        throw new Error('disk full')
      }
      try {
        await page.deleteSongFromSetlist(0)
      } finally {
        db.saveSetlist = realSave
      }
      expect(page.currentSetlist?.songs.map(entry => entry.order)).to.deep.equal([0, 1, 2])
      expect(await savedTitles(setlist.id)).to.deep.equal(['Alpha', 'Bravo', 'Charlie'])

      must(shownToast()?.action).run()
      await until(async () => (await savedTitles(setlist.id)).length === 2)

      expect(await savedTitles(setlist.id)).to.deep.equal(['Bravo', 'Charlie'])
    })
  })

  describe("changing a song's key in the setlist", () => {
    it('saves the key and shows the song in it', async () => {
      const setlist = await open()

      await page.changeSongKeyInSetlist(1, 'A')

      const saved = must(await db.getSetlist(setlist.id))
      expect(saved.songs.map(entry => entry.key)).to.deep.equal(['G', 'A', 'G'])
      expect(page.songs[1].currentKey).to.equal('A')
    })

    it('ignores a song that is not there', async () => {
      const setlist = await open()
      const before = must(await db.getSetlist(setlist.id)).modifiedDate

      await page.changeSongKeyInSetlist(7, 'A')

      expect(must(await db.getSetlist(setlist.id)).modifiedDate).to.equal(before)
    })
  })

  describe('re-rendering a song', () => {
    it('shows the setlist key after the entry changes', async () => {
      const setlist = await open()
      must(page.currentSetlist).songs[0].key = 'A'

      await page.reRenderSong(0)

      expect(page.songs[0].currentKey).to.equal('A')
      expect(page.songs[0].parsed.metadata.key).to.equal('A')
      const display = must(
        root.querySelector<HTMLElement & { parsed: (typeof page.songs)[0]['parsed'] }>(
          '#song-0 song-display'
        )
      )
      expect(display.parsed.metadata.key).to.equal('A')
      expect(setlist.id).to.equal(must(page.currentSetlistId))
    })

    it('shows the tempo the entry overrides', async () => {
      await open()
      must(page.currentSetlist).songs[0].tempo = 120

      await page.reRenderSong(0)

      expect(page.songs[0].currentBPM).to.equal(120)
      expect(page.songs[0].metadata.tempo).to.equal(120)
    })

    it('takes the tempo note from the time signature', async () => {
      await open()
      page.songs[0].metadata = { ...page.songs[0].metadata, timeSignature: '6/8' }
      page.songs[0].sourceText = page.songs[0].sourceText.replace(
        '{tempo: 90}',
        '{tempo: 90}\n{time: 6/8}'
      )

      await page.reRenderSong(0)

      expect(page.songs[0].metadata.timeSignature).to.equal('6/8')
      expect(page.songs[0].metadata.tempoNote).to.equal('1/8')
    })

    it('replaces the song display, once', async () => {
      await open()

      await page.reRenderSong(1)

      expect(root.querySelectorAll('#song-1 song-display')).to.have.length(1)
    })

    it('ignores an index outside the setlist', async () => {
      await open()
      const before = root.innerHTML

      await page.reRenderSong(-1)
      await page.reRenderSong(3)

      expect(root.innerHTML).to.equal(before)
    })
  })

  describe("a song's media preferences", () => {
    const prefsOf = (index: number) =>
      getSongUserPrefs(page.songs[index].songId, must(page.db).organisationId)

    /** The song-change events sent while `act` runs */
    async function eventsDuring(act: () => void) {
      const events: SongChangeEvent[] = []
      const listen = (event: Event) => events.push(event as SongChangeEvent)
      document.addEventListener(SongChangeEvent.type, listen)
      try {
        act()
      } finally {
        document.removeEventListener(SongChangeEvent.type, listen)
      }
      return events
    }

    afterEach(() => {
      localStorage.removeItem(`song-prefs-${db.organisationId}`)
    })

    it('remembers the double click for the song being shown, and tells the media player', async () => {
      await open()
      page.currentSongIndex = 1

      const events = await eventsDuring(() => page.saveSongMediaPref('doubleClick', true))

      expect(prefsOf(1)?.doubleClick).to.equal(true)
      expect(prefsOf(0)).to.equal(null)
      expect(events).to.have.length(1)
      expect(events[0].song?.title).to.equal('Bravo')
      expect(events[0].mediaPrefs.doubleClick).to.equal(true)
    })

    it('remembers the pad set, and that there is none again', async () => {
      await open()
      page.currentSongIndex = 0

      page.saveSongMediaPref('padSetId', 'pads-1')
      expect(prefsOf(0)?.padSetId).to.equal('pads-1')

      const events = await eventsDuring(() => page.saveSongMediaPref('padSetId', undefined))
      expect(prefsOf(0)?.padSetId).to.equal(undefined)
      expect(events[0].mediaPrefs.padSetId).to.equal(undefined)
    })

    it('does nothing on the overview, where no song is being shown', async () => {
      await open()
      page.currentSongIndex = -1

      const events = await eventsDuring(() => page.saveSongMediaPref('doubleClick', true))

      expect(events).to.deep.equal([])
      expect(prefsOf(0)).to.equal(null)
    })
  })

  describe('the capo preference', () => {
    const capoOf = (index: number) =>
      must(root.querySelector<HTMLElement & { capo: number }>(`#song-${index} song-display`)).capo

    it('shows no capo while the preference is off', async () => {
      await open()
      page.songs[0].currentCapo = 2

      page._applyCapoPreferenceToDisplays()

      expect(capoOf(0)).to.equal(0)
    })

    it("shows each song's capo when the preference is turned on, and hides it again when it is turned off", async () => {
      await open()
      page.songs[0].currentCapo = 2
      page.songs[1].currentCapo = 4
      const selector = must(root.querySelector<HTMLElement>('#capo-selector'))

      setCapoPreference(true)
      window.dispatchEvent(new CapoPreferenceEvent(true))
      await settle()

      expect([capoOf(0), capoOf(1), capoOf(2)]).to.deep.equal([2, 4, 0])
      expect(selector.style.display).to.equal('')

      setCapoPreference(false)
      window.dispatchEvent(new CapoPreferenceEvent(false))
      await settle()

      expect([capoOf(0), capoOf(1)]).to.deep.equal([0, 0])
      expect(selector.style.display).to.equal('none')
    })

    describe('with the preference on when the setlist is opened', () => {
      beforeEach(() => setCapoPreference(true))

      /** Be on a song, as if scrolled to it: without the observer of what is in view putting it back */
      const showSong = (index: number) => {
        page.sectionObserver?.disconnect()
        page.currentSongIndex = index
      }

      it('shows the capo selector, on the first song’s capo', async () => {
        await open()
        const selector = must(root.querySelector<HTMLElement & { value: number }>('#capo-selector'))
        expect(selector.style.display).to.equal('')
        expect(selector.value).to.equal(0)
      })

      it('shows a capo chosen in the selector on the song, and not on the others', async () => {
        await open()
        showSong(0)
        const selector = must(root.querySelector<HTMLElement>('#capo-selector'))

        selector.dispatchEvent(new CapoChangeEvent(3))
        for (let i = 0; i < 100 && capoOf(0) !== 3; i++) await wait(20)

        expect(page.songs[0].currentCapo).to.equal(3)
        expect(capoOf(0)).to.equal(3)
        expect(capoOf(1)).to.equal(0)
      })

      it('keeps a capo to the whole numbers there are', async () => {
        await open()
        showSong(0)
        await page.handleCapoChange(40)
        expect(page.songs[0].currentCapo).to.equal(11)
        // The same again changes nothing
        await page.handleCapoChange(11)
        expect(page.songs[0].currentCapo).to.equal(11)
      })

      it('does nothing on the overview, where no song is being shown', async () => {
        await open()
        page.currentSongIndex = -1
        await page.handleCapoChange(4)
        expect(page.songs.every(song => !song.currentCapo)).to.equal(true)
      })
    })

    it('does nothing when an event brings no change', async () => {
      await open()
      page.songs[0].currentCapo = 2

      window.dispatchEvent(new CapoPreferenceEvent(false))
      await settle()

      expect(capoOf(0)).to.equal(0)
    })
  })

  describe('watching which song is in view', () => {
    it('starts again, with the old observer let go, when it is set up a second time', async () => {
      await open()
      const first = must(page.sectionObserver)
      let disconnected = 0
      const realDisconnect = first.disconnect.bind(first)
      first.disconnect = () => {
        disconnected++
        realDisconnect()
      }

      page.setupSectionObserver()

      expect(disconnected).to.equal(1)
      expect(page.sectionObserver).to.not.equal(first)
    })
  })
})
