/** What a song section works out from its lines: bar groups, what the content has, cloning */
import { expect, fixture, html } from '@open-wc/testing'
import { SectionToggleEvent, type SongSection } from '../src/components/song-section.ts'
import '../src/components/song-section.ts'

const { describe, it } = window

type Lines = NonNullable<SongSection['lines']>

const chordsOnly = (...chords: string[]): Lines[number] => ({
  segments: chords.map(chord => ({ chord, lyrics: '' })),
})
const sung = (chord: string, lyrics: string): Lines[number] => ({ segments: [{ chord, lyrics }] })

describe('song-section content', () => {
  async function show(lines: SongSection['lines'], set: Partial<SongSection> = {}) {
    const el = await fixture<SongSection>(html`<song-section></song-section>`)
    Object.assign(el, set)
    el.lines = lines
    await el.updateComplete
    return el
  }

  describe('what the content has, and so the best way to show it', () => {
    it('shows only the chords of a section with no words, only the words of one with no chords, else all', async () => {
      expect((await show([chordsOnly('G', 'C')])).getRecommendedHideMode()).to.equal('lyrics')
      expect((await show([sung('', 'Just words')])).getRecommendedHideMode()).to.equal('chords')
      expect((await show([sung('G', 'Both')])).getRecommendedHideMode()).to.equal('none')
      expect((await show([{ segments: [] }])).getRecommendedHideMode()).to.equal('none')
    })

    it('has nothing to analyse in a line with no segments', async () => {
      const el = await show([{} as Lines[number], sung('G', 'Words')])
      expect(el._hasAnyChords).to.equal(true)
      expect(el._hasAnyLyrics).to.equal(true)
    })

    it('shows no content for no lines', async () => {
      const el = await show([])
      expect(el.shadowRoot?.querySelector('.chord-line')).to.equal(null)
      el.lines = undefined
      await el.updateComplete
      expect(el.lines).to.equal(undefined)
    })
  })

  describe('bar lines', () => {
    it('are grouped with the bar lines next to them, with the lines between left as they are', async () => {
      const el = await show([
        chordsOnly('G', '|', 'C', '|'),
        chordsOnly('D', '||'),
        sung('Em', 'Some words'),
        chordsOnly('A', '|'),
      ])
      const blocks = el._contentBlocks
      expect(blocks.map(block => block.type)).to.deep.equal(['bar-group', 'line', 'bar-group'])
      expect(el.shadowRoot?.querySelectorAll('bar-group')).to.have.length(2)
      expect(el.shadowRoot?.querySelectorAll('.chord-line')).to.have.length(1)
    })

    it('are split into measures, the last one open when it has no bar after it', () => {
      const el = document.createElement('song-section') as SongSection
      const data = el._buildBarGroupData([
        chordsOnly('G', 'C', '|', 'D', ':||', 'Em'),
        chordsOnly('|'),
        {
          segments: [
            { chord: '', lyrics: '' },
            { chord: '|', lyrics: '' },
          ],
        },
      ])
      expect(data.measuresPerLine[0]).to.deep.equal([
        { chords: ['G', 'C'], bar: '|' },
        { chords: ['D'], bar: ':||' },
        { chords: ['Em'], bar: null },
      ])
      expect(data.measuresPerLine[1]).to.deep.equal([{ chords: [], bar: '|' }])
      expect(data.measuresPerLine[2]).to.deep.equal([{ chords: [], bar: '|' }])
      expect(data.maxMeasures).to.equal(3)
    })

    it('have no measures in no lines, and one open measure in a line with no chords', () => {
      const el = document.createElement('song-section') as SongSection
      expect(el._buildBarGroupData([])).to.deep.equal({ measuresPerLine: [], maxMeasures: 0 })
      expect(el._buildBarGroupData([{} as Lines[number]]).measuresPerLine).to.deep.equal([
        [{ chords: [], bar: null }],
      ])
    })

    it('are told from lines of words or chords alone', () => {
      const el = document.createElement('song-section') as SongSection
      expect(el._isBarLineLine(undefined)).to.equal(false)
      expect(el._isBarLineLine({ segments: [] })).to.equal(false)
      expect(el._isBarLineLine(chordsOnly('G', 'C'))).to.equal(false)
      expect(el._isBarLineLine(chordsOnly('G', '|'))).to.equal(true)
      expect(el._isBarLineLine(sung('|', 'words'))).to.equal(false)
      expect(el._isBarLineLine({ segments: [{ chord: '|', lyrics: '   ' }] })).to.equal(true)
      expect(el._buildContentBlocks(undefined as never)).to.deep.equal([])
    })

    it('are not shown when only the words are', async () => {
      const el = await show([chordsOnly('G', '|'), sung('C', 'Words')], { hideMode: 'chords' })
      expect(el.shadowRoot?.querySelector('bar-group')).to.equal(null)
    })

    it('give their display settings to the bar group', async () => {
      const el = await show([chordsOnly('G', '|')], {
        displayAsNashville: true,
        unicodeAccidentals: true,
        displayKey: 'G',
        capo: 2,
        capoKey: 'F',
      })
      const group = el.shadowRoot?.querySelector('bar-group') as unknown as Record<string, unknown>
      expect(group.displayAsNashville).to.equal(true)
      expect(group.unicodeAccidentals).to.equal(true)
      expect(group.displayKey).to.equal('G')
      expect(group.capo).to.equal(2)
      expect(group.capoKey).to.equal('F')
    })
  })

  describe('lines', () => {
    it('leave out a line with no segments', async () => {
      const el = await show([{ segments: [] }, {} as Lines[number], sung('G', 'Words')])
      expect(el.shadowRoot?.querySelectorAll('.chord-line')).to.have.length(1)
    })

    it('show a space for a missing chord, and none at all in a line with no chords', async () => {
      const el = await show([
        {
          segments: [
            { chord: 'G', lyrics: 'Amaz' },
            { chord: '', lyrics: 'ing' },
          ],
        },
        sung('', 'No chords here'),
      ])
      const lines = el.shadowRoot?.querySelectorAll('.chord-line') as NodeListOf<Element>
      expect(lines[0].querySelectorAll('.chord-empty')).to.have.length(1)
      expect(lines[1].querySelector('.chord, .chord-empty')).to.equal(null)
    })

    it('are made of words, with the chords over them, so a line can break between words', async () => {
      const el = await show([
        {
          segments: [
            { chord: '', lyrics: 'More than any - ' },
            { chord: 'Am', lyrics: 'thing that you' },
          ],
        },
      ])
      const units = [...(el.shadowRoot?.querySelectorAll('.chord-unit') ?? [])]
      expect(units.map(unit => unit.textContent?.replace(/\s+/g, ' ').trim())).to.deep.equal([
        'More',
        'than',
        'any',
        '-', // a hyphen between words is still shown
        'Am thing',
        'that',
        'you',
      ])
    })

    it('keep a word with the chords inside it, and a chord over a gap with the word after it', async () => {
      const el = await show([
        {
          segments: [
            { chord: 'G', lyrics: 'You ' },
            { chord: '(Gsus', lyrics: ' ' },
            { chord: 'G)', lyrics: ' (To Bridge)' },
          ],
        },
        {
          segments: [
            { chord: 'Am', lyrics: 'won' },
            { chord: 'C', lyrics: 'der' },
          ],
        },
      ])
      const lines = [...(el.shadowRoot?.querySelectorAll('.chord-line') ?? [])]
      const chordsOf = (unit: Element) =>
        [...unit.querySelectorAll('.chord:not(.chord-empty)')].map(chord =>
          chord.textContent?.replace(/\s+/g, '')
        )
      expect([...lines[0].querySelectorAll('.chord-unit')].map(chordsOf)).to.deep.equal([
        ['G'],
        ['(Gsus', 'G)'], // (and "Bridge)", for the chords to sit over)
      ])
      expect([...lines[1].querySelectorAll('.chord-unit')].map(chordsOf)).to.deep.equal([
        ['Am', 'C'],
      ])
    })

    it('lets a chord spill over the words after it, with no gap after its own word', async () => {
      const el = await show([
        {
          segments: [
            { chord: '', lyrics: 'I walk ' },
            { chord: 'Am7(4)', lyrics: 'it is a wonderful day ' },
            { chord: 'Em7', lyrics: 'now' },
          ],
        },
      ])
      const pieces = [...(el.shadowRoot?.querySelectorAll('.chord-segment') ?? [])]
      const spilling = pieces.filter(piece => piece.classList.contains('chord-spills'))
      // (the chord over "it" spills over "is a wonderful"; "Em7" is last, with nothing to spill over)
      expect(spilling.map(piece => piece.textContent?.replace(/\s+/g, ' ').trim())).to.deep.equal([
        'Am7(4) it',
      ])
      const chordWord = spilling[0]
      const text = document.createRange()
      text.selectNodeContents(chordWord.querySelector('.lyrics') as HTMLElement)
      const next = chordWord.nextElementSibling as HTMLElement
      // no gap: the next word starts where the text of the chord's word ends
      expect(Math.round(next.getBoundingClientRect().left)).to.equal(
        Math.round(text.getBoundingClientRect().right)
      )
    })

    it('does not let a chord spill when another chord is in the next piece', async () => {
      const el = await show([
        {
          segments: [
            { chord: 'Am', lyrics: 'won' },
            { chord: 'C', lyrics: 'der' },
          ],
        },
      ])
      expect(el.shadowRoot?.querySelector('.chord-spills')).to.equal(null)
    })

    it('never start a word with a space, so a word that starts a row is not indented', async () => {
      const el = await show([
        {
          segments: [
            { chord: '', lyrics: 'presence ' },
            { chord: 'C2', lyrics: '  I never ' },
            { chord: 'G', lyrics: ' want' },
          ],
        },
      ])
      const texts = [...(el.shadowRoot?.querySelectorAll('.chord-unit .lyrics') ?? [])].map(
        lyrics => lyrics.textContent as string
      )
      expect(texts.every(text => !/^\s/.test(text))).to.equal(true)
      expect(texts).to.deep.equal(['presence   ', 'I ', 'never  ', 'want'])
    })

    it('wrap between units and never inside one, when the line is narrower than the text', async () => {
      const el = await show([
        {
          segments: [
            { chord: '', lyrics: 'More than any - ' },
            { chord: 'Am7(4)', lyrics: 'thing that you can ' },
            { chord: 'C2', lyrics: 'do I just want ' },
            { chord: 'G', lyrics: 'You ' },
            { chord: '(Gsus', lyrics: ' ' },
            { chord: 'G)', lyrics: ' (To Bridge)' },
          ],
        },
      ])
      el.style.display = 'block'
      el.style.width = '260px'
      const line = el.shadowRoot?.querySelector('.chord-line') as HTMLElement
      const tops = (unit: Element) => [...unit.children].map(c => c.getBoundingClientRect().top)
      const units = [...line.querySelectorAll('.chord-unit')]
      // (the line did wrap, and every unit sits on one row)
      expect(new Set(units.map(unit => unit.getBoundingClientRect().top)).size).to.be.greaterThan(1)
      for (const unit of units) expect(new Set(tops(unit)).size).to.equal(1)
    })

    it('mark an invalid chord', async () => {
      const el = await show([
        { segments: [{ chord: 'Xyz', lyrics: 'oops', valid: false } as never] },
      ])
      expect(el.shadowRoot?.querySelector('.chord.invalid')).to.not.equal(null)
    })

    it('join the words that were one word, when the chords are hidden', async () => {
      const el = await show(
        [
          {
            segments: [
              { chord: 'G', lyrics: 'Amaz' },
              { chord: 'C', lyrics: 'ing - ' },
              { chord: 'D', lyrics: 'grace' },
            ],
          },
        ],
        { hideMode: 'chords' }
      )
      expect(
        el.shadowRoot?.querySelector('.chord-line')?.textContent?.replace(/\s+/g, ' ').trim()
      ).to.contain('Amaz')
      expect(el._formatLyricsText('', false, false)).to.equal('')
      el.hideMode = 'none'
      expect(el._formatLyricsText('a - b', false, false)).to.equal('a - b')
      expect(el._normalizeSegmentLyrics([])).to.deep.equal([])
      expect(el._normalizeSegmentLyrics(undefined as never)).to.deep.equal([])
    })
  })

  describe('as an element', () => {
    it('takes its label from data-label when it has none', async () => {
      const el = await fixture<SongSection>(html`<song-section data-label="Bridge"></song-section>`)
      expect(el.label).to.equal('Bridge')
      const named = await fixture<SongSection>(
        html`<song-section label="Verse" data-label="Bridge"></song-section>`
      )
      expect(named.label).to.equal('Verse')
    })

    it('is cloned with its own copy of the lines, label and note', async () => {
      const el = await show([sung('G', 'Words')], { label: 'Verse', note: 'twice' })
      const clone = el.cloneNode(true) as SongSection
      expect(clone.label).to.equal('Verse')
      expect(clone.note).to.equal('twice')
      expect(clone.lines).to.deep.equal(el.lines)
      expect(clone.lines).to.not.equal(el.lines)
      expect(clone.lines?.[0].segments).to.not.equal(el.lines?.[0].segments)
      expect(document.createElement('div').cloneNode(true)).to.not.equal(null)
    })

    it('has no lines to copy when there are none, or when they are not a list', () => {
      const el = document.createElement('song-section') as SongSection
      expect(el._cloneLines(undefined)).to.deep.equal([])
      expect(el._cloneLines([{} as Lines[number]])).to.deep.equal([{ segments: [] }])
    })

    it('says when its heading is pressed, without following it', async () => {
      const el = await show([sung('G', 'Words')], { label: 'Verse', songIndex: 1, sectionIndex: 2 })
      const seen: SectionToggleEvent[] = []
      el.addEventListener(SectionToggleEvent.type, event => seen.push(event as SectionToggleEvent))
      const summary = el.shadowRoot?.querySelector('summary') as HTMLElement
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      summary.dispatchEvent(click)
      expect(click.defaultPrevented).to.equal(true)
      expect(seen).to.have.length(1)
      expect([seen[0].songIndex, seen[0].sectionIndex]).to.deep.equal([1, 2])
    })

    it('has its details open in edit mode, or unless it is collapsed', async () => {
      const el = await show([sung('G', 'Words')], { label: 'Verse' })
      expect(el._shouldDetailsBeOpen()).to.equal(true)
      el.isCollapsed = true
      expect(el._shouldDetailsBeOpen()).to.equal(false)
      el.isCollapsed = false
      el.hideMode = 'collapse'
      expect(el._shouldDetailsBeOpen()).to.equal(false)
      el.editMode = true
      expect(el._shouldDetailsBeOpen()).to.equal(true)
      expect(el.getDetailsElement()).to.not.equal(null)
    })

    it('has no details element before it is drawn, or with no label', async () => {
      const bare = document.createElement('song-section') as SongSection
      expect(bare.getDetailsElement()).to.equal(null)
      const plain = await show([sung('G', 'Words')])
      expect(plain.getDetailsElement()).to.equal(null)
      expect(plain.shadowRoot?.querySelector('details')).to.equal(null)
    })

    it('names itself by its place when it has no label', async () => {
      const el = await show([sung('G', 'Words')], { sectionIndex: 3 })
      expect(el.shadowRoot?.querySelector('[role="region"]')?.getAttribute('aria-label')).to.equal(
        'Section 4'
      )
    })
  })
})
