import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import { type MelodySheet, MelodySheetErrorEvent } from '../src/components/melody-sheet.ts'
import '../src/components/melody-sheet.ts'
import { sampleMelody } from './melody-sample.ts'
import { wait } from './test-helpers.ts'

const { describe, it } = window

describe('melody-sheet', () => {
  const shown = async (set: Partial<MelodySheet>) => {
    const sheet = await fixture<MelodySheet>(html`<melody-sheet></melody-sheet>`)
    Object.assign(sheet, set)
    await sheet.updateComplete
    await waitUntil(() => sheet._pages.length || sheet._failed, undefined, { timeout: 5000 })
    await sheet.updateComplete
    return sheet
  }
  const notes = (sheet: MelodySheet) =>
    sheet.shadowRoot?.querySelectorAll('.page svg .notehead').length ?? 0

  it('engraves the melody, with the notice under it', async () => {
    const melody = { ...sampleMelody, notice: ['© Public domain', 'CCLI 1234'] }
    const sheet = await shown({ melody, melodyKey: 'C', songKey: 'C' })
    expect(notes(sheet)).to.equal(3)
    expect(sheet.shadowRoot?.querySelectorAll('.notice p')).to.have.length(2)
  })

  it('shows it in the key the song is shown in', async () => {
    const sheet = await shown({ melody: sampleMelody, melodyKey: 'C', songKey: 'C' })
    const before = sheet._pages[0]
    sheet.songKey = 'D'
    await sheet.updateComplete
    await waitUntil(() => sheet._pages[0] !== before, undefined, { timeout: 5000 })
    expect(sheet._pages[0]).to.not.equal(before)
    expect(notes(sheet)).to.equal(3)
  })

  it('shows nothing for a song with no melody, and says so when it cannot be engraved', async () => {
    const empty = await fixture<MelodySheet>(html`<melody-sheet></melody-sheet>`)
    expect(empty.shadowRoot?.querySelectorAll('.page')).to.have.length(0)
    const broken = { ...sampleMelody, measures: null as never }
    let failed = false
    const sheet = await fixture<MelodySheet>(
      html`<melody-sheet @melody-sheet:error=${() => (failed = true)}></melody-sheet>`
    )
    Object.assign(sheet, { melody: broken, melodyKey: 'C', songKey: 'C' })
    await waitUntil(() => sheet._failed, undefined, { timeout: 5000 })
    await sheet.updateComplete
    expect(failed).to.equal(true)
    expect(sheet.shadowRoot?.textContent).to.contain('could not be shown')
    expect(MelodySheetErrorEvent.type).to.equal('melody-sheet:error')
  })

  it('drops an engraving that was asked for before a newer one', async () => {
    const sheet = await shown({ melody: sampleMelody, melodyKey: 'C', songKey: 'C' })
    sheet.songKey = 'D'
    await sheet.updateComplete
    sheet.songKey = 'E'
    await sheet.updateComplete
    const asked = sheet._asked
    await waitUntil(() => !(sheet._pages.length && notes(sheet) === 0), undefined, {
      timeout: 5000,
    })
    await wait(300)
    expect(asked).to.be.greaterThan(2)
    expect(notes(sheet)).to.equal(3)
  })

  it('leaves the notes as written when the key it is to be shown in is not known, and draws a narrow page for a narrow space', async () => {
    const unknown = await shown({ melody: sampleMelody, melodyKey: 'C', songKey: '' })
    expect(notes(unknown)).to.equal(3)
    const narrow = await fixture<MelodySheet>(
      html`<melody-sheet style="width: 360px"></melody-sheet>`
    )
    Object.assign(narrow, { melody: sampleMelody, melodyKey: 'C', songKey: 'C' })
    await waitUntil(() => narrow._pages.length, undefined, { timeout: 5000 })
    await narrow.updateComplete
    expect(notes(narrow)).to.equal(3)
    // (a narrower page is drawn larger once it is fitted to the width: its viewBox is narrower)
    const viewBox = (sheet: MelodySheet) =>
      Number(sheet.shadowRoot?.querySelector('svg')?.getAttribute('viewBox')?.split(' ')[2])
    expect(viewBox(narrow)).to.be.lessThan(viewBox(unknown))
  })
})
