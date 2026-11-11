/**
 * The thin bar for how far something has got (progress-bar.ts): a fraction when it knows how far, and
 * a sliding segment, not an invented fraction, when it does not.
 */
import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/progress-bar.ts'
import type { ProgressBar } from '../src/components/progress-bar.ts'
import { must } from './must.ts'

const { describe, it } = window

const bar = async (current?: number, total?: number, label?: string) =>
  fixture<ProgressBar>(
    html`<progress-bar .current=${current} .total=${total} label=${label ?? 'Progress'}></progress-bar>`
  )
const role = (el: ProgressBar) => must(el.shadowRoot?.querySelector('[role=progressbar]'))
const fill = (el: ProgressBar) => must(el.shadowRoot?.querySelector<HTMLElement>('.fill'))

describe('progress-bar', () => {
  it('fills to the fraction done, which a screen reader is told', async () => {
    const el = await bar(1, 4)
    expect(fill(el).style.width).to.equal('25%')
    expect(role(el).getAttribute('aria-valuenow')).to.equal('25')
    expect(fill(el).classList.contains('unknown')).to.equal(false)
  })

  it('is full when more is done than was counted, and empty before any', async () => {
    expect(fill(await bar(9, 4)).style.width).to.equal('100%')
    expect(fill(await bar(0, 4)).style.width).to.equal('0%')
    expect(fill(await bar(-2, 4)).style.width).to.equal('0%')
  })

  it('does not know how far with no total, or none above nothing: it slides, and says no number', async () => {
    for (const [current, total] of [
      [undefined, undefined],
      [3, undefined],
      [0, 0],
    ] as const) {
      const el = await bar(current, total)
      expect(fill(el).classList.contains('unknown'), `${current}/${total}`).to.equal(true)
      expect(role(el).hasAttribute('aria-valuenow')).to.equal(false)
      expect(fill(el).style.width).to.equal('')
    }
  })

  it('is named for what it is the progress of', async () => {
    expect(role(await bar(1, 2, 'Getting the songs')).getAttribute('aria-label')).to.equal(
      'Getting the songs'
    )
    expect((await bar(1, 2)).label).to.equal('Progress')
  })
})
