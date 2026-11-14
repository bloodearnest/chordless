import { expect } from '@open-wc/testing'
import '../src/components/pitch-selector.ts'
import type { PitchChangeEvent, PitchSelector } from '../src/components/pitch-selector.ts'

const { describe, it, afterEach } = window

describe('pitch-selector', () => {
  let selector: PitchSelector

  async function show(set: Partial<PitchSelector> = {}) {
    selector = document.createElement('pitch-selector')
    Object.assign(selector, set)
    document.body.append(selector)
    await selector.updateComplete
    return selector
  }

  afterEach(() => selector?.remove())

  it('shows its own pitch, or the one it follows when it has none', async () => {
    await show({ followed: 'eb' })
    expect(selector._displayValue()).to.equal('E♭')
    selector.value = 'bb'
    expect(selector._displayValue()).to.equal('B♭')
    selector.value = 'concert'
    expect(selector._displayValue()).to.equal('Concert')
  })

  it('offers the one it follows first, by what it follows, then the four', async () => {
    await show({ followed: 'f', follows: 'the setlist' })
    expect(
      selector._options().map(option => [option.value, option.label, option.hint])
    ).to.deep.equal([
      ['', 'Same as the setlist', 'F'],
      ['concert', 'Concert pitch', ''],
      ['bb', 'B♭ (trumpet, clarinet, tenor sax)', ''],
      ['eb', 'E♭ (alto or baritone sax)', ''],
      ['f', 'F (horn)', ''],
    ])
  })

  it('says a pitch was chosen, as its id, and null for the one above', async () => {
    await show()
    const event = (value: string) => selector._changeEvent(value) as PitchChangeEvent
    expect(event('eb').pitch).to.equal('eb')
    expect(event('nonsense').pitch).to.equal('concert')
    expect(event('').pitch).to.equal(null)
  })
})
