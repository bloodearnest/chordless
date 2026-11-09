import { expect } from '@open-wc/testing'
import { listenForNavigationKeys } from '../src/js/setlist/keyboard-navigation.ts'

const { afterEach, describe, it } = window

describe('the arrow keys of a setlist', () => {
  let controller = new AbortController()
  afterEach(() => controller.abort())

  /** A root with a song in it, whose scrolling is recorded, with a lead sheet in it or not */
  function rig(sheet: boolean) {
    controller = new AbortController()
    const root = document.createElement('div')
    root.innerHTML = `<section id="song-0" style="height: 500px; overflow-y: auto">${
      sheet ? '<score-view></score-view>' : '<song-display></song-display>'
    }</section>`
    document.body.append(root)
    const song = root.querySelector('#song-0') as HTMLElement
    const scrolled: ScrollToOptions[] = []
    song.scrollBy = ((options: ScrollToOptions) => scrolled.push(options)) as typeof song.scrollBy
    listenForNavigationKeys({
      root,
      signal: controller.signal,
      currentIndex: () => 0,
      songCount: () => 1,
      goTo: () => undefined,
      scrollAmount: 200,
      onEscape: () => false,
    })
    return { root, scrolled }
  }
  const press = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key }))

  it('scroll the lyrics by a fixed amount', () => {
    const { root, scrolled } = rig(false)
    press('ArrowDown')
    press('ArrowUp')
    expect(scrolled.map(s => s.top)).to.deep.equal([200, -200])
    root.remove()
  })

  it('scroll a lead sheet by most of a screen, so the last line is kept to read ahead', () => {
    const { root, scrolled } = rig(true)
    press('ArrowDown')
    press('ArrowUp')
    expect(scrolled.map(s => s.top)).to.deep.equal([400, -400])
    root.remove()
  })

  it('leave a hidden lead sheet out of it: the lyrics are what is shown', () => {
    const { root, scrolled } = rig(true)
    root.querySelector('score-view')?.setAttribute('hidden', '')
    press('ArrowDown')
    expect(scrolled.map(s => s.top)).to.deep.equal([200])
    root.remove()
  })
})
