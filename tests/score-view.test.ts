import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import { type ScoreView, ScoreViewErrorEvent } from '../src/components/score-view.ts'
import '../src/components/score-view.ts'
import { setUseUnicodeAccidentals } from '../src/js/preferences.ts'
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

  it('engraves only the measures it is given, with no title or notice', async () => {
    const melody = {
      ...sampleScore,
      notice: ['CCLI 1234'],
      measures: [...sampleScore.measures, ...sampleScore.measures.map(m => ({ ...m, number: 2 }))],
    }
    const whole = await shown({ melody, melodyKey: 'C', songKey: 'C' })
    expect(notes(whole)).to.equal(6)
    const sheet = await shown({ melody, melodyKey: 'C', songKey: 'C', measures: [1] })
    expect(notes(sheet)).to.equal(3)
    expect(sheet.shadowRoot?.querySelector('.title') === null).to.equal(true)
    expect(sheet.shadowRoot?.querySelector('.notice') === null).to.equal(true)
    // (no room kept for the player, and the paper fades into the page above and below)
    expect(getComputedStyle(sheet).paddingBottom).to.equal(getComputedStyle(sheet).paddingTop)
    expect(getComputedStyle(sheet).maskImage).to.contain('linear-gradient')
    // (and at its left and right, which a tablet shows)
    expect(getComputedStyle(sheet).maskImage.match(/linear-gradient/g)).to.have.length(2)
    expect(getComputedStyle(sheet).paddingLeft).to.equal(getComputedStyle(sheet).paddingRight)
  })

  it('writes a flat chord as the letter b, close to its root, or as the sign if that is the preference', async () => {
    const melody = {
      ...sampleScore,
      measures: sampleScore.measures.map(m => ({ ...m, chords: [{ start: 0, text: 'Bbm' }] })),
    }
    const chordText = (sheet: ScoreView) =>
      [...(sheet.shadowRoot?.querySelectorAll('.page g.harm text') ?? [])]
        .map(t => t.textContent?.replace(/\s+/g, ''))
        .join(' ')
    const sheet = await shown({ melody, melodyKey: 'C', songKey: 'C' })
    expect(chordText(sheet)).to.equal('Bbm')
    setUseUnicodeAccidentals(true)
    try {
      await waitUntil(() => chordText(sheet) === 'B♭m', undefined, { timeout: 3000 })
    } finally {
      setUseUnicodeAccidentals(false)
    }
  })

  it('has no title line for a sheet that has none', async () => {
    const melody = { ...sampleScore, title: null, notice: ['(a subtitle)', 'CCLI Song # 1'] }
    const sheet = await shown({ melody, melodyKey: 'C', songKey: 'C' })
    expect(sheet.shadowRoot?.querySelector('.title') === null).to.equal(true)
    expect(sheet.shadowRoot?.querySelector('.subtitle')?.textContent).to.equal('(a subtitle)')
  })

  it('shows the title, as the sheet had it', async () => {
    const sheet = await shown({ melody: sampleScore, melodyKey: 'C', songKey: 'C' })
    expect(sheet.shadowRoot?.querySelector('.title')?.textContent).to.equal('Test')
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
    expect(root.querySelector('.credit .label') === null).to.equal(true)
    expect(root.querySelector('.credit .names')?.textContent).to.equal('Some Writer')
    const bare = { ...sampleScore, notice: ['CCLI Song # 1'] }
    const plain = await shown({ melody: bare, melodyKey: 'C', songKey: 'C' })
    // (the title is still there: it is the only thing in the credits)
    expect(plain.shadowRoot?.querySelector('.credit') === null).to.equal(true)
    expect(plain.shadowRoot?.querySelector('.subtitle') === null).to.equal(true)
    const noSubtitle = { ...sampleScore, notice: ['Words by', 'Some Writer', 'CCLI Song # 1'] }
    const credited = await shown({ melody: noSubtitle, melodyKey: 'C', songKey: 'C' })
    expect(credited.shadowRoot?.querySelector('.subtitle') === null).to.equal(true)
    expect(credited.shadowRoot?.querySelector('.credit .names')?.textContent).to.equal(
      'Some Writer'
    )
  })

  it("draws the music in the sheet's ink, on its paper, whatever the page's text colour", async () => {
    document.documentElement.style.setProperty('--text-color', 'rgb(236, 240, 241)')
    document.documentElement.style.setProperty('--sheet-background', 'rgb(169, 165, 155)')
    document.documentElement.style.setProperty('--sheet-text', 'rgb(0, 0, 0)')
    try {
      const sheet = await shown({ melody: sampleScore, melodyKey: 'C', songKey: 'C' })
      const svg = sheet.shadowRoot?.querySelector('.page svg') as SVGElement
      expect(getComputedStyle(svg).fill).to.equal('rgb(0, 0, 0)')
      expect(getComputedStyle(svg).color).to.equal('rgb(0, 0, 0)')
      expect(getComputedStyle(sheet).backgroundColor).to.equal('rgb(169, 165, 155)')
    } finally {
      for (const name of ['--text-color', '--sheet-background', '--sheet-text']) {
        document.documentElement.style.removeProperty(name)
      }
    }
  })

  describe('fitting the screen', () => {
    /** The sheet in a box that scrolls, `height` px tall */
    async function inBox(height: number) {
      const box = await fixture<HTMLElement>(
        html`<div style="height: ${height}px; overflow-y: auto; width: 600px"><score-view></score-view></div>`
      )
      const sheet = box.querySelector('score-view') as ScoreView
      Object.assign(sheet, { melody: sampleScore, melodyKey: 'C', songKey: 'C' })
      await sheet.updateComplete
      await waitUntil(() => sheet._pages.length, undefined, { timeout: 5000 })
      await sheet.updateComplete
      return { box, sheet }
    }
    const svgOf = (sheet: ScoreView) => sheet.shadowRoot?.querySelector('.page svg') as SVGElement
    /** Page height of the sheet at the full width, and what the foot of the sheet keeps clear */
    const natural = async () => {
      const { sheet } = await inBox(2000)
      const around = (selector: string) =>
        sheet.shadowRoot?.querySelector<HTMLElement>(selector)?.offsetHeight ?? 0
      // (the height of the page at this width, from its proportions)
      const [, , vw, vh] = (svgOf(sheet).getAttribute('viewBox') ?? '').split(' ').map(Number)
      return {
        height: (600 * (vh as number)) / (vw as number),
        // (what is not music: the title above it, and the foot of the sheet kept clear of the player)
        padding:
          Number.parseFloat(getComputedStyle(sheet).paddingBottom) +
          around('.credits') +
          around('.notice'),
      }
    }

    it('is drawn at the full width when it fits, or would have to shrink a lot to', async () => {
      const { height, padding } = await natural()
      const roomy = await inBox(Math.ceil(height + padding) + 50)
      expect(svgOf(roomy.sheet).getBoundingClientRect().width).to.be.closeTo(600, 1)
      const cramped = await inBox(Math.ceil(height * 0.5 + padding))
      expect(svgOf(cramped.sheet).getBoundingClientRect().width).to.be.closeTo(600, 1)
    })

    it('finds what scrolls it through the shadow root it is in', async () => {
      const box = await fixture<HTMLElement>(
        html`<div style="height: 300px; overflow-y: auto"><div id="host"></div></div>`
      )
      const root = (box.querySelector('#host') as HTMLElement).attachShadow({ mode: 'open' })
      const sheet = document.createElement('score-view') as ScoreView
      root.append(sheet)
      Object.assign(sheet, { melody: sampleScore, melodyKey: 'C', songKey: 'C' })
      await waitUntil(() => sheet._pages.length, undefined, { timeout: 5000 })
      await sheet.updateComplete
      // (it was measured against the box: a sheet this small fits, and is left at full width)
      expect(sheet._measured.startsWith(`${sheet.clientWidth}x300x`)).to.equal(true)
    })

    it('is drawn smaller, to fit with no scrolling, when that takes off a little', async () => {
      const { height, padding } = await natural()
      const { sheet } = await inBox(Math.ceil(height * 0.85 + padding))
      await waitUntil(() => sheet._fit < 1, 'the sheet to be fitted')
      await sheet.updateComplete
      const drawn = svgOf(sheet).getBoundingClientRect()
      expect(drawn.width).to.be.closeTo(600 * 0.85, 15)
      expect(drawn.height).to.be.at.most(height * 0.85 + 3)
    })
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
