/** Path shapes normalised and named (src/js/melody-path.ts) */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { absolutePath, shapeHash } from '../src/js/melody-path.ts'

describe('shape names', () => {
  it('finds the same shape written with relative or absolute commands, with or without the closing line', () => {
    const a = absolutePath('M0 -39c0 68 73 172 200 172l-8 3z')
    const b = absolutePath('M0 -39C0 29 73 133 200 133L192 136 0 -39Z')
    assert.equal(shapeHash(a.key), shapeHash(b.key))
  })
})

describe('path normalising', () => {
  it('takes smooth curves, horizontals and verticals as absolute curves and lines', () => {
    const smooth = absolutePath('M0 0c10 0 20 10 20 20s10 10 20 0h5v5z')
    assert.match(smooth.key, /^M0,0 C10,0,20,10,20,20 C20,30,30,30,40,20 L45,20 L45,25 Z$/)
    assert.equal(smooth.box.maxX, 45)
  })
})
