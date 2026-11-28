/** Which songs of a setlist are drawn (src/js/setlist/song-window.ts) */
import { expect } from '@open-wc/testing'
import {
  KEEP_RADIUS,
  SCROLL_SETTLE_MS,
  songsToDraw,
  songsToDrop,
  WINDOW_RADIUS,
} from '../src/js/setlist/song-window.ts'

const { describe, it } = window

describe('songsToDraw', () => {
  it('has the song in view first, then the ones either side, nearest first', () => {
    expect(songsToDraw(5, 20)).to.deep.equal([5, 4, 6, 3, 7])
  })

  it('has the first songs for the overview, which is before the first', () => {
    expect(songsToDraw(-1, 20)).to.deep.equal([0, 1])
  })

  it('stops at the ends of the setlist', () => {
    expect(songsToDraw(0, 20)).to.deep.equal([0, 1, 2])
    expect(songsToDraw(19, 20)).to.deep.equal([19, 18, 17])
    expect(songsToDraw(1, 3)).to.deep.equal([1, 0, 2])
  })

  it('is every song of a setlist that is smaller than the window', () => {
    expect(songsToDraw(2, 3).sort()).to.deep.equal([0, 1, 2])
    expect(songsToDraw(-1, 1)).to.deep.equal([0])
  })

  it('is nothing for a setlist with no songs', () => {
    expect(songsToDraw(-1, 0)).to.deep.equal([])
    expect(songsToDraw(0, 0)).to.deep.equal([])
  })

  it('takes the radius it is given, and has two either side by default', () => {
    expect(WINDOW_RADIUS).to.equal(2)
    expect(songsToDraw(5, 20, 1)).to.deep.equal([5, 4, 6])
    expect(songsToDraw(5, 20, 0)).to.deep.equal([5])
  })

  it('has each song once', () => {
    const drawn = songsToDraw(3, 7, 10)
    expect(new Set(drawn).size).to.equal(drawn.length)
    expect(drawn).to.have.length(7)
  })
})

describe('songsToDrop', () => {
  it('is the drawn songs further from the one in view than the radius, the furthest first', () => {
    // (3 and 9 are as far as each other: they stay in the order they were given)
    expect(songsToDrop([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 6, 2)).to.deep.equal([0, 1, 2, 3, 9])
    expect(songsToDrop([9, 0, 8], 5, 2)).to.deep.equal([0, 9, 8])
  })

  it('keeps the songs within the radius, either side, and the one in view', () => {
    expect(songsToDrop([3, 4, 5, 6, 7], 5, 2)).to.deep.equal([])
    expect(songsToDrop([3, 4, 5, 6, 7], 5, 1)).to.deep.equal([3, 7])
  })

  it('counts the overview as the place before the first song', () => {
    // (the overview is -1: song 4 is five places from it)
    expect(songsToDrop([0, 1, 2, 3, 4], -1, 4)).to.deep.equal([4])
    expect(songsToDrop([0, 1, 2, 3, 4], -1, 3)).to.deep.equal([4, 3])
  })

  it('has nothing to drop when nothing is drawn, or all of it is near', () => {
    expect(songsToDrop([], 5)).to.deep.equal([])
    expect(songsToDrop([4, 5, 6], 5)).to.deep.equal([])
  })

  it('keeps more than it draws ahead, so that going back and forth does not draw a song again and again', () => {
    expect(KEEP_RADIUS).to.be.greaterThan(WINDOW_RADIUS)
    expect(SCROLL_SETTLE_MS).to.be.greaterThan(0)
  })
})
