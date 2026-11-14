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
    expect(selector._displayValue()).to.equal('Half step down')
    selector.value = '2'
    expect(selector._displayValue()).to.equal('Whole step down')
    selector.value = '0'
    expect(selector._displayValue()).to.equal('Standard')
  })

  it('offers the device’s tuning first, naming it, then the three', async () => {
    await show({ deviceTuning: 2 })
    expect(
      selector._options().map(option => [option.value, option.label, option.hint])
    ).to.deep.equal([
      ['', 'Same as my device', 'Whole step down'],
      ['0', 'Standard', ''],
      ['1', 'Half step down', ''],
      ['2', 'Whole step down', ''],
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
