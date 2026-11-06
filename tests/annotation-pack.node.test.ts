/**
 * Keeping annotations on a line and apart (src/js/annotations/pack.ts): in place if they can be, pushed along
 * and back from the edge, in a row above if the row is full, wrapped if wider than the line.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { packAnnotations, placeOnChordRow, type RowItem } from '../src/js/annotations/pack.ts'

const at = (...xs: [number, number][]) => xs.map(([x, w]) => ({ x, w }))
const chord = (x: number, w: number, segment = 0): RowItem => ({ kind: 'chord', x, w, segment })
const note = (x: number, w: number): RowItem => ({ kind: 'annotation', x, w })

test('annotations that fit stay where their words are, on the first row', () => {
  assert.deepEqual(packAnnotations(at([10, 50], [200, 40]), 400, 8), [
    { x: 10, row: 0, wrap: false },
    { x: 200, row: 0, wrap: false },
  ])
})

test('an annotation near the right edge is pulled back inside it', () => {
  assert.deepEqual(packAnnotations(at([350, 100]), 400, 8), [{ x: 300, row: 0, wrap: false }])
  assert.deepEqual(packAnnotations(at([-20, 50]), 400, 8), [{ x: 0, row: 0, wrap: false }])
})

test('annotations that overlap are pushed apart, the earlier one back if the later has no room', () => {
  assert.deepEqual(packAnnotations(at([100, 80], [120, 80]), 400, 8), [
    { x: 100, row: 0, wrap: false },
    { x: 188, row: 0, wrap: false },
  ])
  assert.deepEqual(packAnnotations(at([300, 80], [310, 80]), 400, 8), [
    { x: 232, row: 0, wrap: false },
    { x: 320, row: 0, wrap: false },
  ])
})

test('what does not fit in the row goes in a row above, in the order given back', () => {
  const placed = packAnnotations(at([0, 150], [160, 150], [300, 150]), 400, 8)
  assert.deepEqual(
    placed.map(p => p.row),
    [0, 0, 1]
  )
  assert.equal(placed[2]?.x, 250)
})

test('an annotation wider than the line is set in the line’s width in a row of its own', () => {
  const placed = packAnnotations(at([20, 600], [30, 50]), 400, 8)
  assert.deepEqual(placed[0], { x: 0, row: 0, wrap: true })
  assert.deepEqual(placed[1], { x: 30, row: 1, wrap: false })
})

test('none is none', () => {
  assert.deepEqual(packAnnotations([], 400, 8), [])
})

test('on the chord row: an annotation over a chordless word stays at its word', () => {
  const placed = placeOnChordRow([chord(0, 20), note(60, 40), chord(200, 20, 3)], 400, 8)
  assert.deepEqual(placed[1], { shift: 0, push: undefined, above: 0, wrap: false })
  assert.equal(placed[0], undefined)
})

test('on the chord row: one at a word that has a chord starts after that chord, whichever is listed first', () => {
  for (const items of [
    [chord(0, 20), note(0, 50)],
    [note(0, 50), chord(0, 20)],
  ]) {
    const placed = placeOnChordRow(items, 400, 8)
    const own = placed.find(each => each)
    assert.equal(own?.shift, 28)
    assert.equal(own?.above, 0)
  }
})

test('on the chord row: one under a chord that reaches over its word starts after it', () => {
  const placed = placeOnChordRow([chord(0, 100), note(60, 40)], 400, 8)
  assert.equal(placed[1]?.shift, 48)
})

test('on the chord row: one that would run into the next chord pushes it, by the shortfall, after the piece before', () => {
  const placed = placeOnChordRow([chord(0, 20, 1), note(0, 120), chord(100, 20, 3)], 400, 8)
  assert.deepEqual(placed[1], {
    shift: 28,
    push: { segment: 3, amount: 56 },
    above: 0,
    wrap: false,
  })
})

test('on the chord row: what is pushed moves what follows, so a later annotation is placed after it', () => {
  const placed = placeOnChordRow(
    [chord(0, 20, 1), note(0, 120), chord(100, 20, 3), note(150, 30)],
    400,
    8
  )
  // (the second chord is now at 156, so its end plus a gap is 184, and the second annotation's word is at 206)
  assert.equal(placed[3]?.shift, 0)
  assert.equal(placed[3]?.push, undefined)
})

test('on the chord row: annotations near each other are kept apart', () => {
  const placed = placeOnChordRow([chord(0, 20), note(0, 50), note(30, 50)], 400, 8)
  assert.equal(placed[1]?.shift, 28)
  // the second starts where the first ends, and a gap
  assert.equal(placed[2]?.shift, 28 + 50 + 8 - 30)
})

test('on the chord row: near the end of the line, back from the edge if the chord before allows', () => {
  const placed = placeOnChordRow([chord(0, 20), note(350, 80)], 400, 8)
  assert.equal(placed[1]?.shift, -30)
  assert.equal(placed[1]?.above, 0)
})

test('on the chord row: with no room at the line’s end, a row above', () => {
  const placed = placeOnChordRow([chord(0, 380), note(350, 80)], 400, 8)
  assert.deepEqual(placed[1], { shift: -30, above: 1, wrap: false })
})

test('on the chord row: wider than the line, set in the line’s width in a row above', () => {
  const placed = placeOnChordRow([chord(10, 20), note(40, 600)], 400, 8)
  assert.deepEqual(placed[1], { shift: -40, above: 1, wrap: true })
})

test('on the chord row: a push that is too much to ask of the words goes above instead', () => {
  // 300 wide would push the next chord by 200 of a 400 line
  const placed = placeOnChordRow([chord(0, 20), note(0, 300), chord(100, 20, 2)], 400, 8)
  assert.equal(placed[1]?.above, 1)
  assert.equal(placed[1]?.push, undefined)
})

test('on the chord row: several that cannot be in the row go in rows above, one higher each', () => {
  const placed = placeOnChordRow([note(0, 600), note(0, 600)], 400, 8)
  assert.deepEqual(
    placed.map(each => each?.above),
    [1, 2]
  )
})

test('on the chord row: nothing is nothing', () => {
  assert.deepEqual(placeOnChordRow([], 400, 8), [])
  assert.deepEqual(placeOnChordRow([chord(0, 20)], 400, 8), [])
})
