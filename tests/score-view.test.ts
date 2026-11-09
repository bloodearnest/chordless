import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import { type ScoreView, ScoreViewErrorEvent } from '../src/components/score-view.ts'
import '../src/components/score-view.ts'
import { sampleScore } from './score-sample.ts'

const { describe, it } = window

describe('score-view', () => {
  const shown = async (set: Partial<ScoreView>) => {
    const sheet = await fixture<ScoreView>(html`<score-view></score-view>`)
    Object.assign(sheet, set)
    await sheet.updateComplete
    await waitUntil(() => sheet._pages.length || sheet._failed, undefined, { timeout: 5000 })
    await sheet.updateComplete
    return sheet
  }
  const notes = (sheet: ScoreView) =>
    sheet.shadowRoot?.querySelectorAll('.page svg .notehead').length ?? 0

  it('engraves the melody, with the notice under it', async () => {
    const melody = { ...sampleScore, notice: ['© Public domain', 'CCLI 1234'] }
    const sheet = await shown({ melody, melodyKey: 'C', songKey: 'C' })
    expect(notes(sheet)).to.equal(3)
    expect(sheet.shadowRoot?.querySelectorAll('.notice p')).to.have.length(2)
  })

  it('lays the notice out as CCLI does: credits above the music, the terms centred under it', async () => {
    const melody = {
      ...sampleScore,
      notice: [
        '(based on a recording)',
        'Words and Music by',
        'A Writer and Another',
        'CCLI Song # 1',
        '© Somebody',
      ],
    }
    const sheet = await shown({ melody, melodyKey: 'C', songKey: 'C' })
    const root = sheet.shadowRoot as ShadowRoot
    expect(root.querySelector('.subtitle')?.textContent).to.equal('(based on a recording)')
    expect(root.querySelector('.credit .label')?.textContent).to.equal('Words and Music by')
    expect(root.querySelector('.credit .names')?.textContent).to.equal('A Writer and Another')
    expect([...root.querySelectorAll('.notice p')].map(p => p.textContent)).to.deep.equal([
      'CCLI Song # 1',
      '© Somebody',
    ])
    // (the credits come before the music, and the terms after it)
    const order = [...root.querySelectorAll('.credits, .page, .notice')].map(e => e.className)
    expect(order).to.deep.equal(['credits', 'page', 'notice'])
  })

  it('shows credits with no label, and a subtitle alone', async () => {
    const melody = { ...sampleScore, notice: ['(a subtitle)', 'Some Writer', 'CCLI Song # 1'] }
    const sheet = await shown({ melody, melodyKey: 'C', songKey: 'C' })
    const root = sheet.shadowRoot as ShadowRoot
    expect(root.querySelector('.subtitle')?.textContent).to.equal('(a subtitle)')
    expect(root.querySelector('.credit .label')).to.equal(null)
    expect(root.querySelector('.credit .names')?.textContent).to.equal('Some Writer')
    const bare = { ...sampleScore, notice: ['CCLI Song # 1'] }
    const plain = await shown({ melody: bare, melodyKey: 'C', songKey: 'C' })
    expect(plain.shadowRoot?.querySelector('.credits')).to.equal(null)
    const noSubtitle = { ...sampleScore, notice: ['Words by', 'Some Writer', 'CCLI Song # 1'] }
    const credited = await shown({ melody: noSubtitle, melodyKey: 'C', songKey: 'C' })
    expect(credited.shadowRoot?.querySelector('.subtitle')).to.equal(null)
    expect(credited.shadowRoot?.querySelector('.credit .names')?.textContent).to.equal(
      'Some Writer'
    )
  })

  it('draws the music in the text colour, so a dark theme is not black on black', async () => {
    const sheet = await shown({ melody: sampleScore, melodyKey: 'C', songKey: 'C' })
    const svg = sheet.shadowRoot?.querySelector('.page svg') as SVGElement
    expect(getComputedStyle(svg).fill).to.equal(getComputedStyle(svg).color)
  })

  it('shows it in the key the song is shown in', async () => {
    const sheet = await shown({ melody: sampleScore, melodyKey: 'C', songKey: 'C' })
    const before = sheet._pages[0]
    sheet.songKey = 'D'
    await sheet.updateComplete
    await waitUntil(() => sheet._pages[0] !== before, undefined, { timeout: 5000 })
    expect(sheet._pages[0]).to.not.equal(before)
    expect(notes(sheet)).to.equal(3)
  })

  it('shows nothing for a song with no melody, and says so when it cannot be engraved', async () => {
    const empty = await fixture<ScoreView>(html`<score-view></score-view>`)
    expect(empty.shadowRoot?.querySelectorAll('.page')).to.have.length(0)
    const broken = { ...sampleScore, measures: null as never }
    let failed = false
    const sheet = await fixture<ScoreView>(
      html`<score-view @score-view:error=${() => (failed = true)}></score-view>`
    )
    Object.assign(sheet, { melody: broken, melodyKey: 'C', songKey: 'C' })
    await waitUntil(() => sheet._failed, undefined, { timeout: 5000 })
    await sheet.updateComplete
    expect(failed).to.equal(true)
    expect(sheet.shadowRoot?.textContent).to.contain('could not be shown')
    expect(ScoreViewErrorEvent.type).to.equal('score-view:error')
  })

  it('drops an engraving that was asked for before a newer one', async () => {
    const sheet = await shown({ melody: sampleScore, melodyKey: 'C', songKey: 'C' })
    sheet.songKey = 'D'
    await sheet.updateComplete
    sheet.songKey = 'E'
    await sheet.updateComplete
    const asked = sheet._asked
    await waitUntil(() => !(sheet._pages.length && notes(sheet) === 0), undefined, {
      timeout: 5000,
    })
    await waitUntil(() => asked > 2)
    expect(asked).to.be.greaterThan(2)
    expect(notes(sheet)).to.equal(3)
  })

  it('leaves the notes as written when the key it is to be shown in is not known, and draws a narrow page for a narrow space', async () => {
    const unknown = await shown({ melody: sampleScore, melodyKey: 'C', songKey: '' })
    expect(notes(unknown)).to.equal(3)
    const narrow = await fixture<ScoreView>(html`<score-view style="width: 360px"></score-view>`)
    Object.assign(narrow, { melody: sampleScore, melodyKey: 'C', songKey: 'C' })
    await waitUntil(() => narrow._pages.length, undefined, { timeout: 5000 })
    await narrow.updateComplete
    expect(notes(narrow)).to.equal(3)
    // (a narrower page is drawn larger once it is fitted to the width: its viewBox is narrower)
    const viewBox = (sheet: ScoreView) =>
      Number(sheet.shadowRoot?.querySelector('svg')?.getAttribute('viewBox')?.split(' ')[2])
    expect(viewBox(narrow)).to.be.lessThan(viewBox(unknown))
  })
})
