import { expect } from '@open-wc/testing'
import { normalizeCapo } from '../src/js/utils/capo.ts'

describe('a capo', () => {
  it('is no capo when it is not a number', () => {
    expect([normalizeCapo('x'), normalizeCapo(Number.NaN), normalizeCapo(Infinity)]).to.deep.equal([
      0, 0, 0,
    ])
    expect([normalizeCapo(undefined), normalizeCapo(null)]).to.deep.equal([0, 0])
  })

  it('is a whole number of frets from 0 to 11', () => {
    expect([-3, 0, 2.4, 2.6, '5'].map(normalizeCapo)).to.deep.equal([0, 0, 2, 3, 5])
    expect([11, 40].map(normalizeCapo)).to.deep.equal([11, 11])
  })
})
