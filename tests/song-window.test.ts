/** Which songs of a setlist are drawn (src/js/setlist/song-window.ts) */
import { expect } from '@open-wc/testing'
import { songsToDraw, WINDOW_RADIUS } from '../src/js/setlist/song-window.ts'

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
