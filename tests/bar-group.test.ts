import { expect, fixture, html } from '@open-wc/testing'
import type { BarGroup, BarGroupData } from '../src/components/bar-group.ts'
import '../src/components/bar-group.ts'

const { describe, it } = window

describe('bar-group', () => {
  const show = async (data: BarGroupData | null) => {
    const el = await fixture<BarGroup>(html`<bar-group></bar-group>`)
    el.data = data
    await el.updateComplete
    return el
  }

  it('shows nothing without bars', async () => {
    for (const data of [null, { measuresPerLine: [] }]) {
      const el = await show(data)
      expect(el.shadowRoot?.querySelector('.bar-group')).to.equal(null)
    }
  })

  it('shows a line of chords for each line, a column for each bar of the longest', async () => {
    const el = await show({
      measuresPerLine: [
        [
          { chords: ['G', 'C'], bar: '|' },
          { chords: ['D'], bar: '||' },
        ],
        [{ chords: ['Em'] }],
      ],
      maxMeasures: 2,
    })
    const lines = el.shadowRoot?.querySelectorAll('.chord-line') as NodeListOf<HTMLElement>
    expect(lines).to.have.length(2)
    expect(lines[0].querySelectorAll('.measure')).to.have.length(2)
    // The shorter line is padded to the same columns
    expect(lines[1].querySelectorAll('.measure')).to.have.length(2)
    expect(lines[1].querySelectorAll('.measure')[0].classList.contains('first-measure')).to.equal(
      true
    )
    expect(lines[1].querySelectorAll('.measure')[1].classList.contains('last-measure')).to.equal(
      true
    )
    expect(lines[0].querySelectorAll('chord-display')).to.have.length(3)
    expect(lines[0].querySelectorAll('.bar-marker')).to.have.length(2)
    expect(
      el.shadowRoot?.querySelector<HTMLElement>('.bar-group')?.style.gridTemplateColumns
    ).to.contain('repeat(2')
  })

  it('has at least one column, and takes a bar with no chords', async () => {
    const el = await show({ measuresPerLine: [[{ bar: '|' }]] })
    expect(el.shadowRoot?.querySelectorAll('.measure')).to.have.length(1)
    expect(el.shadowRoot?.querySelectorAll('chord-display')).to.have.length(0)
  })

  it('marks a bar line given as a chord, and leaves out an empty one', async () => {
    const el = await show({ measuresPerLine: [[{ chords: ['|', '', 'A'], bar: '' }]] })
    const chords = el.shadowRoot?.querySelectorAll('.chord')
    expect(chords).to.have.length(2)
    expect(chords?.[0].classList.contains('bar')).to.equal(true)
    expect(chords?.[1].classList.contains('bar')).to.equal(false)
    expect(el.shadowRoot?.querySelector('.bar-marker')).to.equal(null)
  })
})
