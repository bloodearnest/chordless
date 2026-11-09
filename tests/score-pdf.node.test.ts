/** The signs of a lead sheet's page read from its drawing (src/js/score-pdf.ts) */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type Glyph, type Line, type Staff, signsOf } from '../src/js/score-pdf.ts'

describe('repeat signs and endings on a page', () => {
  const staff = (x0: number, x1: number, top: number, sys = 0): Staff & { sys: number } => ({
    x0,
    x1,
    ys: [0, 1, 2, 3, 4].map(i => top + i * 180),
    sys,
  })
  const barLine = (x: number, top: number, width = 27): Line => ({
    x1: x,
    y1: top,
    x2: x,
    y2: top + 720,
    width,
  })
  const dots = (x: number, top: number): Glyph[] =>
    [top + 270, top + 450].map(y => ({ code: 'E1E7', x, y, scale: 1, used: false }))
  const unit = { a: 1, e: 0, f: 0 }
  const run = (text: string, x: number, y: number) => ({
    text,
    x0: x,
    x1: x + 100,
    y,
    size: 10,
    bold: false,
    italic: false,
  })

  it('reads dots before a thick line as the end of a repeat, and a double or final bar', () => {
    const [a, b, c] = [staff(0, 4000, 1000), staff(4000, 8000, 1000), staff(8000, 12000, 1000)]
    const lines = [
      barLine(3800, 1000), // thin
      barLine(3900, 1000, 90), // thick: dots before it
      barLine(7928, 1000),
      barLine(8000, 1000), // two thin ones
      barLine(11900, 1000),
      barLine(12000, 1000, 90), // thin then thick, no dots: final
    ]
    const signs = signsOf([a, b, c], lines, dots(3600, 1000), [], unit)
    assert.equal(signs.get(a)?.bar, 'repeat-end')
    assert.equal(signs.get(b)?.bar, 'double')
    assert.equal(signs.get(c)?.bar, 'final')
    assert.equal(signs.get(a)?.repeatStart, false)
  })

  it('reads dots after a thick line as the start of a repeat, on the next system when at the end of one', () => {
    const [a, b] = [staff(0, 4000, 1000, 0), staff(0, 4000, 3000, 1)]
    // |: in the middle of a measure's left edge, and one drawn at the end of the first system
    const lines = [barLine(3700, 1000, 90), barLine(3800, 1000), barLine(4000, 1000)]
    const signs = signsOf([a, b], lines, dots(3860, 1000), [], unit)
    assert.equal(signs.get(a)?.repeatStart, false)
    assert.equal(signs.get(b)?.repeatStart, true)
    assert.equal(signs.get(a)?.bar, 'single')
    const left = signsOf(
      [b],
      [barLine(300, 3000, 90), barLine(400, 3000)],
      dots(460, 3000),
      [],
      unit
    )
    assert.equal(left.get(b)?.repeatStart, true)
  })

  it('reads a numbered ending: a line over the measures, a hook down at its left and right ends', () => {
    const [a, b, c] = [staff(0, 4000, 3000), staff(4000, 8000, 3000), staff(8000, 12000, 3000)]
    const line = (x1: number, x2: number): Line => ({ x1, y1: 2000, x2, y2: 2000, width: 13 })
    const hook = (x: number): Line => ({ x1: x, y1: 2000, x2: x, y2: 2328, width: 13 })
    const lines = [
      line(4000, 7900),
      hook(4000),
      hook(7900), // closed: "1"
      line(8000, 12000),
      hook(8000), // open: "2,3"
    ]
    const runs = [run('1', 4073, 2328), run('2, 3', 8073, 2328), run('7', 100, 2328)]
    const signs = signsOf([a, b, c], lines, [], runs, unit)
    assert.equal(signs.get(a)?.ending, null)
    assert.deepEqual(signs.get(b)?.ending, { label: '1', start: true, stop: true, closed: true })
    assert.deepEqual(signs.get(c)?.ending, {
      label: '2,3',
      start: true,
      stop: true,
      closed: false,
    })
  })
})
