import { expect } from '@open-wc/testing'
import '../src/components/tuning-selector.ts'
import type { TuningChangeEvent, TuningSelector } from '../src/components/tuning-selector.ts'

const { describe, it, afterEach } = window

describe('tuning-selector', () => {
  let selector: TuningSelector

  async function show(set: Partial<TuningSelector> = {}) {
    selector = document.createElement('tuning-selector')
    Object.assign(selector, set)
    document.body.append(selector)
    await selector.updateComplete
    return selector
  }

  afterEach(() => selector?.remove())

  it('shows the setlist’s own tuning, or the device’s when it has none', async () => {
    await show({ deviceTuning: 1 })
    expect(selector._displayValue()).to.equal('E♭ standard (-1)')
    selector.value = '2'
    expect(selector._displayValue()).to.equal('D standard (-2)')
    selector.value = '0'
    expect(selector._displayValue()).to.equal('Standard (E)')
  })

  it('offers the device’s tuning first, naming it, then each tuning', async () => {
    await show({ deviceTuning: 2 })
    expect(
      selector._options().map(option => [option.value, option.label, option.hint])
    ).to.deep.equal([
      ['', 'Same as my device', 'D standard (-2)'],
      ['0', 'Standard (E)', ''],
      ['1', 'E♭ standard (-1)', ''],
      ['2', 'D standard (-2)', ''],
      ['3', 'D♭ standard (-3)', ''],
      ['4', 'C standard (-4)', ''],
      ['5', 'B standard (-5)', ''],
    ])
  })

  it('says a tuning was chosen, as a number, and null for the device’s', async () => {
    await show({ value: '1' })
    const events = (value: string) => selector._changeEvent(value) as TuningChangeEvent
    expect(events('2').tuning).to.equal(2)
    expect(events('0').tuning).to.equal(0)
    expect(events('').tuning).to.equal(null)
  })
})
