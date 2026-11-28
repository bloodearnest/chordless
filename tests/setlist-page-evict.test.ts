/**
 * The setlist page takes songs away that are far from the one in view, waits for scrolling to stop
 * before it draws or takes any away, and asks for the layout to be checked when it opens and after the
 * first swipe (docs/LAZY_SONGS.md).
 */
import { expect, waitUntil } from '@open-wc/testing'
import { setScrollToTopOnSwipe } from '../src/js/preferences.ts'
import { SCROLL_SETTLE_MS } from '../src/js/setlist/song-window.ts'
import { must, useSetlistPage } from './setlist-page-harness.ts'

const { describe, it } = window

describe('the setlist page keeps only the songs near the one in view', () => {
  const rig = useSetlistPage()

  /** The songs that have their chart in the page, by place */
  const drawn = () => [0, 1, 2, 3].filter(index => rig.page._songDrawn(index))
  const windowed = { windowed: true }
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  /** Give a song's section something to scroll, and scroll it */
  const scrollSong = (index: number, top: number) => {
    const section = must(rig.$<HTMLElement>(`#song-${index}`))
    // (no scroll anchoring: the song above the tall block renders after this, and would nudge the position)
    section.style.cssText = 'height: 100px; overflow-y: auto; overflow-anchor: none'
    const tall = document.createElement('div')
    tall.style.height = '2000px'
    section.append(tall)
    section.scrollTop = top
    return section
  }

  describe('taking songs away', () => {
    it('takes away the songs further from the one in view than are kept, and keeps their places in the row', async () => {
      await rig.open(4, {}, windowed)
      await rig.drawAll()
      expect(drawn()).to.deep.equal([0, 1, 2, 3])
      rig.page._keepRadius = 1

      void rig.page._drawAround(0)
      await waitUntil(() => drawn().length === 2, 'the far songs to be taken away')

      expect(drawn()).to.deep.equal([0, 1])
      // (a place in the row each, with nothing in it: the row is as it was)
      expect(rig.$$('.section[id^="song-"]')).to.have.length(4)
      expect(must(rig.$('#song-3 .song-content')).children).to.have.length(0)
    })

    it('keeps where a song was scrolled to, and puts it back when the song is drawn again', async () => {
      setScrollToTopOnSwipe(false)
      try {
        await rig.open(4, {}, windowed)
        await rig.drawAll()
        scrollSong(3, 40)
        rig.page._keepRadius = 1
        void rig.page._drawAround(0)
        await waitUntil(() => !rig.page._songDrawn(3), 'song 3 to be taken away')
        expect(rig.page._scrollsWhenDrawn.get('song-3')).to.equal(40)
        // (and a page that is restored keeps it too)
        expect(rig.page.captureViewState()?.scrolls?.['song-3']).to.equal(40)

        await rig.page._drawSong(3)
        expect(rig.page._scrollsWhenDrawn.has('song-3')).to.equal(false)
      } finally {
        setScrollToTopOnSwipe(true)
      }
    })

    it('keeps no place for a song when songs start at their top', async () => {
      setScrollToTopOnSwipe(true)
      await rig.open(4, {}, windowed)
      await rig.drawAll()
      scrollSong(3, 40)
      rig.page._keepRadius = 1
      void rig.page._drawAround(0)
      await waitUntil(() => !rig.page._songDrawn(3), 'song 3 to be taken away')
      expect(rig.page._scrollsWhenDrawn.has('song-3')).to.equal(false)
    })

    it('does not take away a song shown as its lead sheet, which would be engraved again', async () => {
      await rig.open(4, {}, windowed)
      await rig.drawAll()
      rig.page.applyMelodyMode = async () => {}
      rig.page._melodyOn.add(3)
      rig.page._keepRadius = 1
      void rig.page._drawAround(0)
      await waitUntil(() => !rig.page._songDrawn(2), 'song 2 to be taken away')
      await rig.flush()
      await rig.flush()
      expect(drawn()).to.deep.equal([0, 1, 3])
    })

    it('does not take away a song that is within the kept ones, so that going back does not draw it again', async () => {
      await rig.open(4, {}, windowed)
      await rig.drawAll()
      rig.page._keepRadius = 3
      void rig.page._drawAround(0)
      await rig.flush()
      await rig.flush()
      expect(drawn()).to.deep.equal([0, 1, 2, 3])
    })

    it('forgets where songs were scrolled to when they are moved, which is by place', async () => {
      await rig.open(4, {}, windowed)
      await rig.drawAll()
      rig.page._scrollsWhenDrawn.set('song-2', 30)
      await rig.page.moveSong(0, 1)
      expect(rig.page._scrollsWhenDrawn.size).to.equal(0)
    })

    it('leaves alone a song that is not there, and one that is not drawn', async () => {
      await rig.open(4, {}, windowed)
      await waitUntil(() => drawn().length === 2)
      rig.page._undrawSong(9)
      rig.page._undrawSong(3)
      expect(drawn()).to.deep.equal([0, 1])
      expect(rig.$$('.section[id^="song-"]')).to.have.length(4)
    })

    it('says how many songs are drawn, for the report of the frames on each song', async () => {
      await rig.open(4, {}, windowed)
      await rig.drawAll()
      expect(rig.page._drawnCount()).to.equal(4)
    })
  })

  describe('while the page is being scrolled', () => {
    it('does not draw the songs to come until it has stopped for a moment', async () => {
      await rig.open(4, {}, windowed)
      await waitUntil(() => drawn().length === 2)
      // (song 1 is in view, as after a swipe: 2 and 3 are the ones to draw)
      window.dispatchEvent(new Event('scroll'))
      const scrolledAt = performance.now()
      void rig.page._drawAround(1)
      await wait(SCROLL_SETTLE_MS / 2)
      expect(rig.page._songDrawn(2)).to.equal(false)

      await waitUntil(
        () => rig.page._songDrawn(2) && rig.page._songDrawn(3),
        'the songs to be drawn'
      )
      expect(performance.now() - scrolledAt).to.be.at.least(SCROLL_SETTLE_MS - 5)
    })

    it('goes on waiting while the scrolling goes on', async () => {
      await rig.open(4, {}, windowed)
      await waitUntil(() => drawn().length === 2)
      void rig.page._drawAround(1)
      // (a scroll every 40 ms for a while: nothing is drawn in it)
      for (let tick = 0; tick < 8; tick++) {
        window.dispatchEvent(new Event('scroll'))
        await wait(40)
        expect(rig.page._songDrawn(2)).to.equal(false)
      }
      await waitUntil(() => rig.page._songDrawn(2), 'the song to be drawn once it stopped')
    })

    it('still draws the song to be shown at once, which is not to wait for', async () => {
      await rig.open(4, {}, windowed)
      await waitUntil(() => drawn().length === 2)
      window.dispatchEvent(new Event('scroll'))
      void rig.page._drawAround(3)
      expect(rig.page._songDrawn(3)).to.equal(true)
    })

    it('takes songs away only when it has stopped too', async () => {
      await rig.open(4, {}, windowed)
      await rig.drawAll()
      rig.page._keepRadius = 1
      window.dispatchEvent(new Event('scroll'))
      void rig.page._drawAround(0)
      await wait(SCROLL_SETTLE_MS / 2)
      expect(rig.page._songDrawn(3)).to.equal(true)
      await waitUntil(() => !rig.page._songDrawn(3), 'song 3 to be taken away once it stopped')
    })
  })

  describe('checking the layout', () => {
    /** The page's section observer, with its callback in hand, as the header's tests have it */
    function observed() {
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
      return (id: string) =>
        seen?.([{ isIntersecting: true, intersectionRatio: 1, target: { id } }])
    }

    it('is asked for after the first swipe, and no other', async () => {
      await rig.open(4, {}, windowed)
      const asked: string[] = []
      const layout = must(rig.page._layout)
      layout.checkSoon = reason => {
        asked.push(reason)
      }
      const swipeTo = observed()
      swipeTo('song-0')
      swipeTo('song-1')
      swipeTo('overview')
      expect(asked).to.deep.equal(['swipe'])
    })

    it('does not count a move the page makes as a swipe', async () => {
      await rig.open(4, {}, windowed)
      expect(rig.page._swipeChecked).to.equal(false)
      rig.page.showSong(2, true)
      expect(rig.page._swipeChecked).to.equal(false)
    })
  })
})
