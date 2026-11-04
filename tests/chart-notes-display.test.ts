import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/song-display.ts'
import type { SongDisplay } from '../src/components/song-display.ts'
import { NoteRequestEvent, type SongSection } from '../src/components/song-section.ts'
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

  it('on a section with no name are above its lines', async () => {
    const plain = new ChordProParser().parse('{title: A}\n{key: G}\n\n[G]Amazing grace')
    const sources = putNote(noSources(), note('intro', sectionAnchor(plain.sections, 0)), {
      scope: 'setlist',
      reach: 'private',
    })
    const display = await fixture<SongDisplay>(html`<song-display></song-display>`)
    display.parsed = plain
    display.notes = notesBySection(plain.sections, sources)
    await display.updateComplete
    const section = display.shadowRoot?.querySelector('song-section') as SongSection
    await section.updateComplete
    expect(text(section.shadowRoot?.querySelector('.plain-notes .note'))).to.equal('intro')
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

  describe('in edit mode', () => {
    const labelled = new ChordProParser().parse(
      '{title: A}\n{key: G}\n\n{comment: Verse}\n[G]Amazing [C]grace how sweet'
    )
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    async function editing(withNotes = noSources()) {
      const display = await fixture<SongDisplay>(html`<song-display></song-display>`)
      display.parsed = labelled
      display.songIndex = 3
      display.notes = notesBySection(labelled.sections, withNotes)
      await display.updateComplete
      const section = display.shadowRoot?.querySelector('song-section') as SongSection
      section.editMode = true
      await section.updateComplete
      const requests: NoteRequestEvent[] = []
      display.addEventListener(NoteRequestEvent.type, event =>
        requests.push(event as NoteRequestEvent)
      )
      return { display, section, root: section.shadowRoot as ShadowRoot, requests }
    }

    const press = (target: Element) =>
      target.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          composed: true,
          isPrimary: true,
          pointerId: 1,
          pointerType: 'touch',
        })
      )

    it('asks for the note editor when a word or the title is held', async () => {
      const { root, requests } = await editing()
      press(root.querySelectorAll('.chord-segment')[1] as Element)
      await wait(650)
      press(root.querySelector('.section-title') as Element)
      await wait(650)
      expect(
        requests.map(each => [
          each.songIndex,
          each.sectionIndex,
          each.place,
          each.line,
          each.offset,
          each.noteId,
        ])
      ).to.deep.equal([
        [3, 0, 'text', 0, 8, undefined],
        [3, 0, 'title', 0, 0, undefined],
      ])
      expect(requests[0].element.classList.contains('chord-segment')).to.equal(true)
    })

    it('makes the words reachable by keyboard, and asks with the context-menu key', async () => {
      const { root, requests } = await editing()
      expect(root.querySelector('.chord-segment')?.getAttribute('tabindex')).to.equal('0')
      const summary = root.querySelector('summary') as HTMLElement
      summary.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ContextMenu',
          bubbles: true,
          composed: true,
          cancelable: true,
        })
      )
      expect(requests.map(each => each.place)).to.deep.equal(['title'])
    })

    it('asks for the editor on a note that is tapped, with its id, and does not collapse the section', async () => {
      let sources = putNote(noSources(), note('spot', textAnchor(labelled.sections, 0, 0, 8)), {
        scope: 'setlist',
        reach: 'private',
      })
      sources = putNote(sources, note('head', sectionAnchor(labelled.sections, 0)), {
        scope: 'setlist',
        reach: 'private',
      })
      const { root, section, requests } = await editing(sources)
      let toggled = 0
      section.addEventListener('song-section:toggle', () => toggled++)
      ;(root.querySelector('.segment-notes .note') as HTMLElement).click()
      ;(root.querySelector('.section-title-wrapper .note') as HTMLElement).click()
      expect(requests.map(each => [each.place, each.noteId, each.line, each.offset])).to.deep.equal(
        [
          ['text', 'spot', 0, 8],
          ['title', 'head', 0, 0],
        ]
      )
      expect(toggled).to.equal(0)
    })

    it('does nothing for a hold or a tap when not editing', async () => {
      const sources = putNote(noSources(), note('spot', textAnchor(labelled.sections, 0, 0, 8)), {
        scope: 'setlist',
        reach: 'private',
      })
      const { section, root, requests } = await editing(sources)
      section.editMode = false
      await section.updateComplete
      press(root.querySelectorAll('.chord-segment')[1] as Element)
      await wait(650)
      ;(root.querySelector('.segment-notes .note') as HTMLElement).click()
      expect(requests).to.deep.equal([])
      expect(root.querySelector('.chord-segment')?.hasAttribute('tabindex')).to.equal(false)
    })

    it('has a place in the song’s strip for a note on the whole song, and one to start it', async () => {
      document.body.classList.add('edit-mode')
      try {
        const sources = putNote(noSources(), note('whole', { kind: 'song' }), {
          scope: 'song',
          reach: 'private',
        })
        const { display, requests } = await editing(sources)
        await display.updateComplete
        const strip = display.shadowRoot as ShadowRoot
        ;(strip.querySelector('.song-notes .note') as HTMLElement).click()
        ;(strip.querySelector('.add-song-note') as HTMLElement).click()
        // (what is in the strip but is not a note does nothing)
        ;(strip.querySelector('.song-notes') as HTMLElement).click()
        expect(requests.map(each => [each.place, each.noteId, each.songIndex])).to.deep.equal([
          ['song', 'whole', 3],
          ['song', undefined, 3],
        ])
      } finally {
        document.body.classList.remove('edit-mode')
      }
    })

    it('leaves a song’s strip alone when not editing: taps do nothing, and with no notes there is none', async () => {
      const sources = putNote(noSources(), note('whole', { kind: 'song' }), {
        scope: 'song',
        reach: 'private',
      })
      const { display, requests } = await editing(sources)
      ;(
        (display.shadowRoot as ShadowRoot).querySelector('.song-notes .note') as HTMLElement
      ).click()
      expect(requests).to.deep.equal([])
      expect(display.shadowRoot?.querySelector('.add-song-note')).to.equal(null)
      display.notes = notesBySection(labelled.sections, noSources())
      await display.updateComplete
      expect(display.shadowRoot?.querySelector('.song-notes')).to.equal(null)
    })
  })
})
