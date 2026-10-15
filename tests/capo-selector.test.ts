import { expect } from '@open-wc/testing'
import '../src/components/capo-selector.ts'
import type { CapoSelector } from '../src/components/capo-selector.ts'

const { describe, it, afterEach } = window

describe('capo-selector', () => {
  let selector: CapoSelector

  async function show(set: Partial<CapoSelector> = {}) {
    selector = document.createElement('capo-selector')
    Object.assign(selector, set)
    document.body.append(selector)
    await selector.updateComplete
    return selector
  }

  const hints = () => selector._options().map(option => option.hint)

  afterEach(() => selector?.remove())

  it('shows 0 for a value that is not a number', async () => {
    await show({ value: Number.NaN })
    expect(selector._displayValue()).to.equal(0)
    selector.value = 3
    expect(selector._displayValue()).to.equal(3)
  })

  it('offers 0 to 11, or up to the highest it is given, and no more than 11', async () => {
    await show()
    expect(selector._options().map(option => option.value)).to.have.length(12)
    selector.maxValue = 4
    expect(selector._options().map(option => option.value)).to.deep.equal([0, 1, 2, 3, 4])
    selector.maxValue = 40
    expect(selector._options()).to.have.length(12)
    selector.maxValue = -1
    expect(selector._options()).to.have.length(12)
    selector.maxValue = Number.NaN
    expect(selector._options()).to.have.length(12)
  })

  it('says how far down each capo is when it does not know the key', async () => {
    await show({ maxValue: 2 })
    expect(hints()).to.deep.equal(['Open', 'Down 1', 'Down 2'])
  })

  it('says the key each capo is played in, for a song in a key', async () => {
    await show({ maxValue: 2, referenceKey: 'G' })
    expect(hints()).to.deep.equal(['G', 'F#', 'F'])
  })

  it('shows a key it cannot move as it is', async () => {
    await show({ maxValue: 1, referenceKey: 'not a key' })
    expect(hints()).to.deep.equal(['not a key', 'not a key'])
  })
})
