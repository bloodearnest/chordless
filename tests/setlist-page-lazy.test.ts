/**
 * The setlist page draws only the songs near the one in view (docs/LAZY_SONGS.md): a place in the row
 * for every song, and the chart of the ones near it, drawn before it is scrolled to, and ahead of a swipe.
 */
import { expect, waitUntil } from '@open-wc/testing'
import type { SongDisplay } from '../src/components/song-display.ts'
import type { SongSection } from '../src/components/song-section.ts'
import {
  setCapoPreference,
  setScrollToTopOnSwipe,
  setTelemetryPreference,
} from '../src/js/preferences.ts'
import { must, useSetlistPage } from './setlist-page-harness.ts'

const { describe, it } = window

describe('the setlist page draws the songs near the one in view', () => {
  const rig = useSetlistPage()

  /** The songs that have their chart in the page, by place */
  const drawn = () => [0, 1, 2, 3].filter(index => rig.page._songDrawn(index)).sort((a, b) => a - b)
  const windowed = { windowed: true }

  it('has a place in the row for every song, and the first songs drawn from the overview', async () => {
    await rig.open(4, {}, windowed)
    // (a place for each: the row, its snap points and the addresses are the same whatever is drawn)
    expect(rig.$$('.section[id^="song-"]').map(section => section.id)).to.deep.equal([
      'song-0',
      'song-1',
      'song-2',
      'song-3',
    ])
    await waitUntil(() => drawn().length === 2, 'the songs near the overview to be drawn')
    expect(drawn()).to.deep.equal([0, 1])
    expect(rig.$$('#song-2 song-display, #song-3 song-display')).to.have.length(0)
  })

  it('draws a song that is opened on, and the ones around it, and not the first', async () => {
    await rig.open(4, {}, { ...windowed, songIndex: 3 })
    await waitUntil(() => drawn().length === 3, 'the songs near song 3 to be drawn')
    expect(drawn()).to.deep.equal([1, 2, 3])
    expect(rig.$$('#song-0 song-display')).to.have.length(0)
  })

  it('draws the song at once when it is the one to be shown, before it is scrolled to', async () => {
    await rig.open(4, {}, windowed)
    await waitUntil(() => drawn().length === 2)
    expect(rig.page._songDrawn(3)).to.equal(false)
    rig.page.showSong(3, true)
    // (in the same turn: no frame shows it empty)
    expect(rig.page._songDrawn(3)).to.equal(true)
    // ...and the ones near it follow, a frame each
    await waitUntil(() => rig.page._songDrawn(1) && rig.page._songDrawn(2))
    // (the ones drawn before are left: nothing is taken away yet)
    expect(drawn()).to.deep.equal([0, 1, 2, 3])
  })

  it('draws the songs near the one swiped to', async () => {
    await rig.open(4, {}, windowed)
    await waitUntil(() => drawn().length === 2)
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
    seen?.([{ isIntersecting: true, intersectionRatio: 1, target: { id: 'song-1' } }])
    expect(rig.page.currentSongIndex).to.equal(1)
    await waitUntil(() => drawn().length === 4, 'the songs near song 1 to be drawn')
  })

  it('gives a song drawn later what the page has now: the tuning, the capo and its section states', async () => {
    setCapoPreference(true)
    await rig.open(4, {}, windowed)
    await waitUntil(() => drawn().length === 2)
    rig.page.changeSetlistTuning(2)
    await waitUntil(() => rig.page.effectiveTuning() === 2)
    rig.page.sections.states = {
      3: { 0: { hideMode: 'chords', isCollapsed: false, isHidden: false } },
    }

    await rig.page._drawSong(3)

    const display = must(rig.$<SongDisplay>('#song-3 song-display'))
    expect(display.tuning).to.equal(2)
    expect(display.songIndex).to.equal(3)
    expect(display.parsed?.metadata.title).to.equal('Delta')
    const first = display.shadowRoot?.querySelector<SongSection>('song-section')
    await waitUntil(() => first?.hideMode === 'chords', 'the section state to be applied')
  })

  it('draws a song once, however many times it is asked for', async () => {
    await rig.open(4, {}, windowed)
    await Promise.all([rig.page._drawSong(2), rig.page._drawSong(2), rig.page._drawSong(2)])
    expect(rig.$$('#song-2 song-display')).to.have.length(1)
  })

  it('leaves a song with no chart as a place in the row, and one that is not there alone', async () => {
    await rig.open(4, {}, windowed)
    await rig.page._drawSong(9)
    expect(drawn()).to.not.include(9)
  })

  it('does not draw a song again for an edit before it is drawn: it is drawn with the new text when it is', async () => {
    await rig.open(4, {}, windowed)
    await waitUntil(() => drawn().length === 2)
    expect(rig.page._songDrawn(3)).to.equal(false)
    await rig.page.reRenderSong(3)
    expect(rig.page._songDrawn(3)).to.equal(false)
    await rig.page._drawSong(3)
    expect(must(rig.$<SongDisplay>('#song-3 song-display')).parsed).to.equal(
      rig.page.songs[3]?.parsed
    )
  })

  it('puts back how far a song was scrolled when it is drawn, which it could not be before', async () => {
    await rig.open(4, {}, windowed)
    await waitUntil(() => drawn().length === 2)
    rig.page._scrollsWhenDrawn.set('song-3', 40)
    await rig.page._drawSong(3)
    expect(rig.page._scrollsWhenDrawn.has('song-3')).to.equal(false)
  })

  it('puts back a scroll the page was restored with, for a song that was not drawn, when it is', async () => {
    setScrollToTopOnSwipe(false)
    try {
      await rig.open(4, {}, windowed)
      await waitUntil(() => drawn().length === 2)
      rig.page._restoredState = { scrolls: { 'song-3': 40, 'song-0': 10 } }
      rig.page._restoreScrolls()
      // (song 0 is drawn: it is put back at once; song 3 is not, so it waits to be)
      expect(rig.page._scrollsWhenDrawn.get('song-3')).to.equal(40)
      expect(rig.page._scrollsWhenDrawn.has('song-0')).to.equal(false)
    } finally {
      setScrollToTopOnSwipe(true)
    }
  })

  it('gives a song with no entry in the library the note about getting it', async () => {
    await rig.open(4, {}, windowed)
    await waitUntil(() => drawn().length === 2)
    must(rig.page.songs[3]).missing = true
    await rig.page._drawSong(3)
    expect(must(rig.$('#song-3 .song-content')).querySelector('a')?.getAttribute('href')).to.be.a(
      'string'
    )
    expect(must(rig.$('#song-3 .song-content')).querySelector('p')).to.not.equal(null)
  })

  it('draws a song as its lead sheet when it is shown as one, and lets a song with none go back to its lyrics', async () => {
    await rig.open(4, {}, windowed)
    await waitUntil(() => drawn().length === 2)
    rig.page._melodyOn.add(3)
    await rig.page._drawSong(3)
    // (this song has no lead sheet: the page asked, found none, and the song stays in its lyrics)
    expect(rig.page._melodyOn.has(3)).to.equal(false)
    expect(rig.page._songDrawn(3)).to.equal(true)
  })

  it('draws a song first when its lead sheet is asked for before it is drawn', async () => {
    await rig.open(4, {}, windowed)
    await waitUntil(() => drawn().length === 2)
    expect(rig.page._songDrawn(3)).to.equal(false)
    await rig.page.applyMelodyMode(3)
    expect(rig.page._songDrawn(3)).to.equal(true)
  })

  it('draws nothing more for a page that has been left, whether the song was under way or asked for after', async () => {
    await rig.open(4, {}, windowed)
    await waitUntil(() => drawn().length === 2)
    const under = rig.page._drawSong(3)
    rig.page.dispose()
    await under
    // (and a call after, as a late swipe or tap might make: nothing is drawn, now or a frame later)
    await rig.page._drawAround(2)
    expect(rig.page._songDrawn(2)).to.equal(false)
    await rig.flush()
    await rig.flush()
    expect(rig.page._songDrawn(2)).to.equal(false)
    expect(rig.page._drawQueue).to.deep.equal([])
  })

  it('stops drawing the ones still to come when the page is left', async () => {
    await rig.open(4, {}, windowed)
    rig.page.dispose()
    expect(rig.page._drawQueue).to.deep.equal([])
  })

  it('says how many songs it drew at first, in the report of the setlist opening', async () => {
    setTelemetryPreference(true)
    await rig.open(4, {}, windowed)
    const times = await rig.page._timeDrawing()
    expect(times.drawn).to.equal(2)
    expect(times.domElements).to.be.greaterThan(0)
  })
})
