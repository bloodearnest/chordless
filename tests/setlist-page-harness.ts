/**
 * The setlist page started on the elements the setlist view gives it, against songs and a
 * setlist saved in the space's database under names of their own. Call `useSetlistPage()`
 * inside a describe; read `rig.page`, `rig.root`, `rig.visited` and the rest as properties of it.
 */
import { render } from 'lit'
import '../src/components/app-modal.ts'
import '../src/components/nav-menu.ts'
import '../src/components/song-display.ts'
import '../src/components/song-section.ts'
import type { Setlist } from '../src/js/data-types.ts'
import { type ChordlessDB, getCurrentDB } from '../src/js/db.ts'
import { setRouter } from '../src/js/navigation.ts'
import { setCapoPreference } from '../src/js/preferences.ts'
import { SetlistPage } from '../src/js/setlist-page.ts'
import { setlistTemplate } from '../src/js/views/setlist-view.ts'
import { makeEntry, makeSetlist, makeSong } from './builders.ts'
import { must } from './must.ts'
import { clearToasts, suppressConsoleLogs } from './test-helpers.ts'

const { before, beforeEach, afterEach } = window

export const chartOf = (title: string, key: string, tempo = 90) =>
  `{title: ${title}}\n{key: ${key}}\n{tempo: ${tempo}}\n{time: 4/4}\n\n{comment: Verse 1}\n[${key}]Amazing [C]grace\n\n{comment: Chorus}\nHow sweet the sound`

export function useSetlistPage() {
  suppressConsoleLogs()

  /** A frame, for what the page finishes setting up after it starts */
  const flush = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  const $ = <T extends HTMLElement>(selector: string) => rig.root.querySelector<T>(selector)
  const $$ = <T extends HTMLElement>(selector: string) => [
    ...rig.root.querySelectorAll<T>(selector),
  ]

  const rig = {
    db: undefined as unknown as ChordlessDB,
    songs: [] as { uuid: string; id: string; title: string }[],
    root: undefined as unknown as HTMLElement,
    page: undefined as unknown as SetlistPage,
    /** Where goTo() was asked to go, as {url, replace} */
    visited: [] as { url: string; replace?: boolean }[],
    errors: [] as unknown[][],
    /** Save a song (and its chart) to the library */
    saveSong,
    open,
    $,
    $$,
    flush,
  }
  let run = ''
  let realError: typeof console.error

  async function saveSong(title: string, key = 'G', tempo = 90) {
    const id = crypto.randomUUID()
    const song = { uuid: `song-${id}`, id: `title-${run}-${title}`, title }
    await rig.db.saveChordPro({
      id: `chordpro-${id}`,
      content: chartOf(title, key, tempo),
      contentHash: id,
      lastModified: Date.now(),
    })
    await rig.db.saveSong(
      makeSong({
        uuid: song.uuid,
        id: song.id,
        title,
        titleNormalized: title.toLowerCase(),
        chordproFileId: `chordpro-${id}`,
        key,
        originalKey: key,
        tempo,
        originalTempo: tempo,
      })
    )
    return song
  }

  /** Save a setlist of the first `count` songs, and start the page on it */
  async function open(
    count = 3,
    overrides: Partial<Setlist> = {},
    options: { songIndex?: number; readOnly?: boolean } = {}
  ) {
    const setlist = makeSetlist({
      id: `setlist-${crypto.randomUUID()}`,
      songs: rig.songs
        .slice(0, count)
        .map((song, order) =>
          makeEntry({ order, songId: song.id, songUuid: song.uuid, key: 'G', tempo: 90 })
        ),
      ...overrides,
    })
    await rig.db.saveSetlist(setlist)
    // (a page left running would go on listening to the document)
    rig.page?.dispose()
    rig.page = new SetlistPage({
      root: rig.root,
      setlistId: setlist.id,
      db: rig.db,
      songIndex: options.songIndex,
      readOnly: options.readOnly,
    })
    await rig.page.start()
    await flush()
    // (the page is not laid out as it is in a browser tab: what it says is in view is not so)
    rig.page.sectionObserver?.disconnect()
    return setlist
  }

  before(async () => {
    rig.db = await getCurrentDB()
    run = crypto.randomUUID()
    rig.songs = [
      await saveSong('Alpha'),
      await saveSong('Bravo'),
      await saveSong('Charlie'),
      await saveSong('Delta', 'D'),
    ]
  })

  beforeEach(() => {
    rig.visited = []
    setRouter({
      navigate: async (url: string, options?: { replace?: boolean }) => {
        rig.visited.push({ url, replace: options?.replace })
        return true
      },
    })
    setCapoPreference(false)
    localStorage.removeItem('section_defaults')
    rig.root = document.createElement('div')
    document.body.append(rig.root)
    render(setlistTemplate({ editable: true, shareable: true }), rig.root)
    rig.errors = []
    realError = console.error
    console.error = (...args: unknown[]) => {
      rig.errors.push(args)
    }
  })

  afterEach(() => {
    rig.page?.dispose()
    setRouter(null)
    rig.root.remove()
    clearToasts()
    console.error = realError
    setCapoPreference(false)
    localStorage.removeItem('section_defaults')
    localStorage.removeItem(`song-prefs-${rig.db.spaceId}`)
    document.body.classList.remove('edit-mode', 'header-expanded')
    document.body.removeAttribute('data-edit-mode')
    delete document.body.dataset.view
  })

  return rig
}

export { must }
