/**
 * Keeping annotations on a line and apart (src/js/annotations/pack.ts): in place if they can be, pushed along
 * and back from the edge, in a row above if the row is full, wrapped if wider than the line.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { packAnnotations } from '../src/js/annotations/pack.ts'

const at = (...xs: [number, number][]) => xs.map(([x, w]) => ({ x, w }))

test('annotations that fit stay where their words are, on the first row', () => {
  assert.deepEqual(packAnnotations(at([10, 50], [200, 40]), 400, 8), [
    { x: 10, row: 0, wrap: false },
    { x: 200, row: 0, wrap: false },
  ])
})

test('a annotation near the right edge is pulled back inside it', () => {
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

test('a annotation wider than the line is set in the line’s width in a row of its own', () => {
  const placed = packAnnotations(at([20, 600], [30, 50]), 400, 8)
  assert.deepEqual(placed[0], { x: 0, row: 0, wrap: true })
  assert.deepEqual(placed[1], { x: 30, row: 1, wrap: false })
})

test('none is none', () => {
  assert.deepEqual(packAnnotations([], 400, 8), [])
})
