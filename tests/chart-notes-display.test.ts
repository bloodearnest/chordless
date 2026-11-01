import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/song-display.ts'
import type { SongDisplay } from '../src/components/song-display.ts'
import type { SongSection } from '../src/components/song-section.ts'
import type { ChartNote } from '../src/js/data-types.ts'
import { sectionAnchor, textAnchor } from '../src/js/notes/anchor.ts'
import { notesBySection } from '../src/js/notes/shown.ts'
import { noSources, putNote } from '../src/js/notes/store.ts'
import { ChordProParser } from '../src/js/parser.ts'

const { describe, it } = window

const parsed = new ChordProParser().parse(
  '{title: A}\n{key: G}\n\n{comment: Verse}\n[G]Amazing [C]grace how sweet\n\n{comment: Chorus}\n[D]Oh how free'
)

const note = (id: string, anchor: ChartNote['anchor']): ChartNote => ({
  id,
  anchor,
  body: { kind: 'text', text: id },
  modified: '',
})

async function show(notes: ReturnType<typeof notesBySection>, hideMode?: string) {
  const display = await fixture<SongDisplay>(html`<song-display></song-display>`)
  display.parsed = parsed
  display.notes = notes
  await display.updateComplete
  const sections = Array.from(
    display.shadowRoot?.querySelectorAll<SongSection>('song-section') ?? []
  )
  for (const section of sections) {
    if (hideMode) section.hideMode = hideMode as never
    await section.updateComplete
  }
  return { display, sections }
}

const text = (el: Element | null | undefined) => el?.textContent?.trim()

describe('notes on a chart', () => {
  it('sit right of a section’s title, in the title row', async () => {
    const sources = putNote(noSources(), note('softly', sectionAnchor(parsed.sections, 1)), {
      scope: 'setlist',
      reach: 'shared',
    })
    const { sections } = await show(notesBySection(parsed.sections, sources))
    const title = sections[1].shadowRoot?.querySelector('.section-title')
    const shown = sections[1].shadowRoot?.querySelector('.section-title-wrapper .note')
    expect(text(shown)).to.equal('softly')
    expect(shown?.classList.contains('shared')).to.equal(true)
    expect(shown?.getBoundingClientRect().left).to.be.greaterThan(
      title?.getBoundingClientRect().right ?? 0
    )
    expect(sections[0].shadowRoot?.querySelector('.note')).to.equal(null)
  })

  it('sit above their word, with the chord between, and take no width', async () => {
    const sources = putNote(noSources(), note('build', textAnchor(parsed.sections, 0, 0, 8)), {
      scope: 'setlist',
      reach: 'private',
    })
    const { sections } = await show(notesBySection(parsed.sections, sources))
    const root = sections[0].shadowRoot as ShadowRoot
    const shownNote = root.querySelector('.segment-notes .note') as HTMLElement
    const segment = shownNote.closest('.chord-segment') as HTMLElement
    expect(text(shownNote)).to.equal('build')
    expect(text(segment.querySelector('.lyrics'))).to.equal('grace')
    expect(shownNote.classList.contains('shared')).to.equal(false)
    const chord = segment.querySelector('.chord') as HTMLElement
    expect(shownNote.getBoundingClientRect().bottom).to.be.at.most(
      chord.getBoundingClientRect().top + 1
    )
    expect(
      Math.abs(shownNote.getBoundingClientRect().left - segment.getBoundingClientRect().left)
    ).to.be.lessThan(2)
    // (it does not push the next words along)
    const lyrics = root.querySelector('.chord-line')
    expect(lyrics?.classList.contains('has-notes')).to.equal(true)
    expect(getComputedStyle(shownNote.parentElement as Element).position).to.equal('absolute')
  })

  it('cut a word list in the middle of a segment, keeping the lyrics whole', async () => {
    const sources = putNote(noSources(), note('here', textAnchor(parsed.sections, 0, 0, 14)), {
      scope: 'setlist',
      reach: 'private',
    })
    const { sections } = await show(notesBySection(parsed.sections, sources))
    const root = sections[0].shadowRoot as ShadowRoot
    expect(text(root.querySelector('.chord-line'))?.replace(/\s+/g, ' ')).to.contain('here')
    const lyrics = Array.from(root.querySelectorAll('.lyrics'))
      .map(each => each.textContent)
      .join('')
    expect(lyrics.replace(/\s+/g, ' ')).to.equal('Amazing grace how sweet')
  })

  it('are still there when the chords are hidden', async () => {
    const sources = putNote(noSources(), note('build', textAnchor(parsed.sections, 0, 0, 8)), {
      scope: 'setlist',
      reach: 'private',
    })
    const { sections } = await show(notesBySection(parsed.sections, sources), 'chords')
    const shownNote = sections[0].shadowRoot?.querySelector('.segment-notes .note') as HTMLElement
    expect(text(shownNote)).to.equal('build')
    expect(shownNote.getBoundingClientRect().height).to.be.greaterThan(0)
  })

  it('for the whole song, or whose place is gone, show above the sections, the latter marked', async () => {
    let sources = putNote(noSources(), note('slowly', { kind: 'song' }), {
      scope: 'song',
      reach: 'private',
    })
    sources = putNote(sources, note('lost', { kind: 'section', label: 'Bridge', nth: 0 }), {
      scope: 'setlist',
      reach: 'private',
    })
    const { display } = await show(notesBySection(parsed.sections, sources))
    const strip = Array.from(display.shadowRoot?.querySelectorAll('.song-notes .note') ?? [])
    expect(strip.map(each => [text(each), each.classList.contains('orphan')])).to.deep.equal([
      ['lost', true],
      ['slowly', false],
    ])
  })

  describe('placed so they do not run off the line or into each other', () => {
    const frame = () =>
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    async function narrow(...notes: [number, string][]) {
      let sources = noSources()
      for (const [offset, words] of notes) {
        const made = {
          ...note(words, textAnchor(parsed.sections, 0, 0, offset)),
          body: { kind: 'text', text: words },
        } as ChartNote
        sources = putNote(sources, made, { scope: 'setlist', reach: 'private' })
      }
      const wrapper = await fixture<HTMLElement>(
        html`<div style="width: 300px; --font-lyrics: 21px; --font-chords: 19px; --font-note: 18px"></div>`
      )
      const display = document.createElement('song-display') as SongDisplay
      wrapper.append(display)
      display.parsed = parsed
      display.notes = notesBySection(parsed.sections, sources)
      await display.updateComplete
      const section = display.shadowRoot?.querySelector('song-section') as SongSection
      await section.updateComplete
      await frame()
      const root = section.shadowRoot as ShadowRoot
      return {
        line: root.querySelector('.chord-line') as HTMLElement,
        notes: Array.from(root.querySelectorAll<HTMLElement>('.segment-notes')),
      }
    }

    it('keeps a note near the right edge inside the line', async () => {
      const { line, notes } = await narrow([14, 'a long way to the right edge'])
      const edge = line.getBoundingClientRect().right
      expect(notes[0].getBoundingClientRect().right).to.be.at.most(edge + 1)
      expect(notes[0].getBoundingClientRect().left).to.be.at.least(
        line.getBoundingClientRect().left - 1
      )
    })

    it('moves them again when the line gets narrower', async () => {
      const { line, notes } = await narrow([14, 'a long way to the right edge'])
      const wrapper = line.getRootNode() as ShadowRoot
      const host = (wrapper.host.getRootNode() as ShadowRoot).host.parentElement as HTMLElement
      host.style.width = '230px'
      await frame()
      await frame()
      expect(notes[0].getBoundingClientRect().right).to.be.at.most(
        line.getBoundingClientRect().right + 1
      )
      expect(notes[0].getBoundingClientRect().left).to.be.at.least(
        line.getBoundingClientRect().left - 1
      )
    })

    it('pushes notes on neighbouring words apart', async () => {
      const { notes } = await narrow([0, 'quietly at first'], [8, 'then build up'])
      const [a, b] = notes.map(each => each.getBoundingClientRect())
      expect(a.right).to.be.at.most(b.left)
    })

    it('puts what does not fit in a row above, and makes room for it', async () => {
      const { line, notes } = await narrow(
        [0, 'quietly at first'],
        [8, 'then build up slowly'],
        [14, 'all drop out']
      )
      expect(line.style.getPropertyValue('--note-rows')).to.equal('2')
      const tops = new Set(notes.map(each => Math.round(each.getBoundingClientRect().top)))
      expect(tops.size).to.equal(2)
      const first = notes.map(each => each.getBoundingClientRect()).sort((a, b) => a.top - b.top)[0]
      expect(first.top).to.be.at.least(line.getBoundingClientRect().top - 1)
    })
  })
})
