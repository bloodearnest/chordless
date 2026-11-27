/** Whether a move along the setlist's row of songs is to a neighbour or a jump (src/js/setlist/scroll-distance.ts) */
import { expect } from '@open-wc/testing'
import { isJump } from '../src/js/setlist/scroll-distance.ts'

const { describe, it } = window

describe('isJump', () => {
  const width = 400

  it('is not a jump to the song next to this one, either way', () => {
    expect(isJump(0, 400, width)).to.equal(false)
    expect(isJump(800, 1200, width)).to.equal(false)
    expect(isJump(1200, 800, width)).to.equal(false)
  })

  it('is not a jump to where it already is, or to a snap point that is a little off', () => {
    expect(isJump(800, 800, width)).to.equal(false)
    expect(isJump(0, 400 + 40, width)).to.equal(false)
  })

  it('is a jump to a song that is two or more away, either way', () => {
    expect(isJump(0, 800, width)).to.equal(true)
    expect(isJump(0, 4400, width)).to.equal(true)
    expect(isJump(4400, 0, width)).to.equal(true)
  })

  it('is the same measure from half way through a slide: it is the distance left that counts', () => {
    // (a slide that has gone half way, asked to go on to the song after: that is one and a half widths)
    expect(isJump(200, 800, width)).to.equal(false)
    expect(isJump(0, 801, width)).to.equal(true)
  })

  it('is not a jump in a row with no width, which a page not laid out has, rather than always one', () => {
    expect(isJump(0, 0, 0)).to.equal(false)
  })
})
