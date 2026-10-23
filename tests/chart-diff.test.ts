import { expect, fixture, html } from '@open-wc/testing'
import type { ChartDiff } from '../src/components/chart-diff.ts'
import '../src/components/chart-diff.ts'
import type { SongDisplay } from '../src/components/song-display.ts'
import { A11Y } from './test-helpers.ts'

const { describe, it } = window

const chart = (verse: string, key = 'G') =>
  `{title: Grace}\n{key: ${key}}\n{comment: Verse 1}\n${verse}\n{comment: Chorus}\n[G]Hallelujah\n`
const CHARTS: [string, string] = [chart('[G]Amazing grace'), chart('[Am]Amazing grace', 'A')]
const LABELS: [{ heading: string; detail: string }, { heading: string; detail: string }] = [
  { heading: 'In your library', detail: 'Imported by Simon' },
  { heading: 'Importing', detail: 'Imported by Jo' },
]

describe('chart-diff', () => {
  const show = (
    charts,
    labels: typeof LABELS | null = LABELS,
    keys: (string | null)[] = ['G', 'A']
  ) =>
    fixture<ChartDiff>(
      html`<chart-diff .charts=${charts} .keys=${keys} .labels=${labels}></chart-diff>`
    )
  const $ = (el: ChartDiff, selector: string) => el.shadowRoot?.querySelector(selector)
  const all = (el: ChartDiff, selector: string) => [
    ...(el.shadowRoot?.querySelectorAll(selector) ?? []),
  ]
  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim()
  /** The chords the chart showing is shown with */
  const chordsShown = (el: ChartDiff) =>
    ($(el, 'song-display') as SongDisplay).parsed?.sections.flatMap(section =>
      section.lines.flatMap(line => line.segments.map(segment => segment.chord))
    )

  it('shows nothing without charts', async () => {
    const el = await show(null)
    expect($(el, '[role=tablist]')).to.equal(null)
  })

  it('has a tab for each chart, with its key, and the library first, shown as a song', async () => {
    const el = await show(CHARTS)
    const tabs = all(el, '[role=tab]')
    expect(tabs.map(text)).to.deep.equal(['In your library · key G', 'Importing · key A'])
    expect(tabs.map(tab => tab.getAttribute('aria-selected'))).to.deep.equal(['true', 'false'])
    expect(text($(el, '.detail'))).to.equal('Imported by Simon')
    expect(($(el, 'song-display') as SongDisplay).parsed?.sections.map(s => s.label)).to.deep.equal(
      ['Verse 1', 'Chorus']
    )
    expect(chordsShown(el)).to.include('G')
  })

  it('shows the other chart under the other tab, and the first again on going back', async () => {
    const el = await show(CHARTS)
    ;(all(el, '[role=tab]')[1] as HTMLElement).click()
    await el.updateComplete
    expect(text($(el, '.detail'))).to.equal('Imported by Jo')
    expect(chordsShown(el)).to.include('Am')
    ;(all(el, '[role=tab]')[0] as HTMLElement).click()
    await el.updateComplete
    expect(chordsShown(el)).to.not.include('Am')
  })

  it('is accessible, as far as the song display is', async () => {
    const el = await show(CHARTS)
    await expect(el).to.be.accessible({ ...A11Y, ignoredRules: ['nested-interactive'] })
  })

  it('moves between the tabs with the arrow keys, and ignores the others', async () => {
    const el = await show(CHARTS, null)
    const key = (name: string) =>
      $(el, '[role=tablist]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true })
      )
    key('ArrowRight')
    await el.updateComplete
    await el.updateComplete
    expect(all(el, '[role=tab]')[1].getAttribute('aria-selected')).to.equal('true')
    expect(el.shadowRoot?.activeElement?.id).to.equal('tab-1')
    key('ArrowLeft')
    await el.updateComplete
    await el.updateComplete
    expect(all(el, '[role=tab]')[0].getAttribute('aria-selected')).to.equal('true')
    key('Enter')
    await el.updateComplete
    expect(all(el, '[role=tab]')[0].getAttribute('aria-selected')).to.equal('true')
    expect(text($(el, '.detail'))).to.equal('')
  })

  it('leaves the key out of a tab when the chart has none', async () => {
    const el = await show(CHARTS, LABELS, [null, null])
    expect(all(el, '[role=tab]').map(text)).to.deep.equal(['In your library', 'Importing'])
    const withoutKeys = await fixture<ChartDiff>(html`<chart-diff .charts=${CHARTS}></chart-diff>`)
    expect(all(withoutKeys, '[role=tab]').map(text)).to.deep.equal(['', ''])
  })
})
