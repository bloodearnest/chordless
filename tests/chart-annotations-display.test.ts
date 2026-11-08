import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/song-display.ts'
import type { SongDisplay } from '../src/components/song-display.ts'
import { AnnotationRequestEvent, type SongSection } from '../src/components/song-section.ts'
import { sectionAnchor, textAnchor } from '../src/js/annotations/anchor.ts'
import { annotationsBySection } from '../src/js/annotations/shown.ts'
import { noSources, putAnnotation } from '../src/js/annotations/store.ts'
import type { ChartAnnotation } from '../src/js/data-types.ts'
import { ChordProParser } from '../src/js/parser.ts'
import { makeAnnotation } from './builders.ts'

const { describe, it } = window

const parsed = new ChordProParser().parse(
  '{title: A}\n{key: G}\n\n{comment: Verse}\n[G]Amazing [C]grace how sweet\n\n{comment: Chorus}\n[D]Oh how free'
)

async function show(annotations: ReturnType<typeof annotationsBySection>, hideMode?: string) {
  const display = await fixture<SongDisplay>(html`<song-display></song-display>`)
  display.parsed = parsed
  display.annotations = annotations
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

describe('annotations on a chart', () => {
  it('sit right of a section’s title, in the title row', async () => {
    const sources = putAnnotation(
      noSources(),
      makeAnnotation('softly', sectionAnchor(parsed.sections, 1)),
      'shared'
    )
    const { sections } = await show(annotationsBySection(parsed.sections, sources))
    const title = sections[1].shadowRoot?.querySelector('.section-title')
    const shown = sections[1].shadowRoot?.querySelector('.section-title-wrapper .annotation')
    expect(text(shown)).to.equal('softly')
    expect(shown?.classList.contains('shared')).to.equal(true)
    expect(shown?.getBoundingClientRect().left).to.be.greaterThan(
      title?.getBoundingClientRect().right ?? 0
    )
    expect(sections[0].shadowRoot?.querySelector('.annotation')).to.equal(null)
  })

  it('on a section with no name are above its lines', async () => {
    const plain = new ChordProParser().parse('{title: A}\n{key: G}\n\n[G]Amazing grace')
    const sources = putAnnotation(
      noSources(),
      makeAnnotation('intro', sectionAnchor(plain.sections, 0)),
      'private'
    )
    const display = await fixture<SongDisplay>(html`<song-display></song-display>`)
    display.parsed = plain
    display.annotations = annotationsBySection(plain.sections, sources)
    await display.updateComplete
    const section = display.shadowRoot?.querySelector('song-section') as SongSection
    await section.updateComplete
    expect(text(section.shadowRoot?.querySelector('.plain-annotations .annotation'))).to.equal(
      'intro'
    )
  })

  it('cut a word list in the middle of a segment, keeping the lyrics whole', async () => {
    const sources = putAnnotation(
      noSources(),
      makeAnnotation('here', textAnchor(parsed.sections, 0, 0, 14)),
      'private'
    )
    const { sections } = await show(annotationsBySection(parsed.sections, sources))
    const root = sections[0].shadowRoot as ShadowRoot
    expect(text(root.querySelector('.chord-line'))?.replace(/\s+/g, ' ')).to.contain('here')
    const lyrics = Array.from(root.querySelectorAll('.lyrics'))
      .map(each => each.textContent)
      .join('')
    expect(lyrics.replace(/\s+/g, ' ')).to.equal('Amazing grace how sweet')
  })

  it('are still there when the chords are hidden', async () => {
    const sources = putAnnotation(
      noSources(),
      makeAnnotation('build', textAnchor(parsed.sections, 0, 0, 8)),
      'private'
    )
    const { sections } = await show(annotationsBySection(parsed.sections, sources), 'chords')
    const shownAnnotation = sections[0].shadowRoot?.querySelector(
      '.segment-annotations .annotation'
    ) as HTMLElement
    expect(text(shownAnnotation)).to.equal('build')
    expect(shownAnnotation.getBoundingClientRect().height).to.be.greaterThan(0)
  })

  it('for the whole song, or whose place is gone, show above the sections, the latter marked', async () => {
    let sources = putAnnotation(noSources(), makeAnnotation('slowly', { kind: 'song' }), 'private')
    sources = putAnnotation(
      sources,
      makeAnnotation('lost', { kind: 'section', label: 'Bridge', nth: 0 }),
      'private'
    )
    const { display } = await show(annotationsBySection(parsed.sections, sources))
    const strip = Array.from(
      display.shadowRoot?.querySelectorAll('.song-annotations .annotation') ?? []
    )
    expect(strip.map(each => [text(each), each.classList.contains('orphan')])).to.deep.equal([
      ['slowly', false],
      ['lost', true],
    ])
  })

  describe('placed so they do not run off the line or into each other', () => {
    const frame = () =>
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    async function narrow(...annotations: [number, string][]) {
      let sources = noSources()
      for (const [offset, words] of annotations) {
        const made = {
          ...makeAnnotation(words, textAnchor(parsed.sections, 0, 0, offset)),
          body: { kind: 'text', text: words },
        } as ChartAnnotation
        sources = putAnnotation(sources, made, 'private')
      }
      const wrapper = await fixture<HTMLElement>(
        html`<div style="width: 300px; --font-lyrics: 21px; --font-chords: 19px; --font-annotation: 18px"></div>`
      )
      const display = document.createElement('song-display') as SongDisplay
      wrapper.append(display)
      display.parsed = parsed
      display.annotations = annotationsBySection(parsed.sections, sources)
      await display.updateComplete
      const section = display.shadowRoot?.querySelector('song-section') as SongSection
      await section.updateComplete
      await frame()
      const root = section.shadowRoot as ShadowRoot
      return {
        line: root.querySelector('.chord-line') as HTMLElement,
        annotations: Array.from(root.querySelectorAll<HTMLElement>('.segment-annotations')),
      }
    }

    it('keeps an annotation near the right edge inside the line', async () => {
      const { line, annotations } = await narrow([14, 'a long way to the right edge'])
      const edge = line.getBoundingClientRect().right
      expect(annotations[0].getBoundingClientRect().right).to.be.at.most(edge + 1)
      expect(annotations[0].getBoundingClientRect().left).to.be.at.least(
        line.getBoundingClientRect().left - 1
      )
    })

    it('moves them again when the line gets narrower', async () => {
      const { line, annotations } = await narrow([14, 'a long way to the right edge'])
      const wrapper = line.getRootNode() as ShadowRoot
      const host = (wrapper.host.getRootNode() as ShadowRoot).host.parentElement as HTMLElement
      host.style.width = '230px'
      await frame()
      await frame()
      expect(annotations[0].getBoundingClientRect().right).to.be.at.most(
        line.getBoundingClientRect().right + 1
      )
      expect(annotations[0].getBoundingClientRect().left).to.be.at.least(
        line.getBoundingClientRect().left - 1
      )
    })

    it('pushes annotations on neighbouring words apart', async () => {
      const { annotations } = await narrow([0, 'quietly at first'], [8, 'then build up'])
      const [a, b] = annotations.map(each => each.getBoundingClientRect())
      expect(a.right).to.be.at.most(b.left)
    })
  })

  describe('on the chord row', () => {
    const frames = async (n = 5) => {
      for (let i = 0; i < n; i++) await new Promise(resolve => requestAnimationFrame(resolve))
    }
    const wide = new ChordProParser().parse(
      '{title: A}\n{key: G}\n\n{comment: Verse}\n[G]Amazing [C]grace [D]how sweet the sound'
    )

    /** The chart laid out at `width` with its text sizes (the test page has no stylesheet), with these annotations */
    async function laidOut(
      chart: typeof wide,
      spots: [number, string][],
      { width = 360, hide }: { width?: number; hide?: string } = {}
    ) {
      let sources = noSources()
      for (const [offset, words] of spots) {
        const made = {
          ...makeAnnotation(words, textAnchor(chart.sections, 0, 0, offset)),
          body: { kind: 'text', text: words },
        } as ChartAnnotation
        sources = putAnnotation(sources, made, 'private')
      }
      const wrapper = await fixture<HTMLElement>(
        html`<div style="width: ${width}px; --font-lyrics: 21px; --font-chords: 19px; --font-annotation: 18px"></div>`
      )
      const display = document.createElement('song-display') as SongDisplay
      wrapper.append(display)
      display.parsed = chart
      display.annotations = annotationsBySection(chart.sections, sources)
      await display.updateComplete
      const section = display.shadowRoot?.querySelector('song-section') as SongSection
      if (hide) section.hideMode = hide as never
      await section.updateComplete
      await frames()
      const root = section.shadowRoot as ShadowRoot
      const line = root.querySelector('.chord-line') as HTMLElement
      const rect = (el: Element) => el.getBoundingClientRect()
      return {
        line,
        lineRect: rect(line),
        annotations: Array.from(root.querySelectorAll<HTMLElement>('.segment-annotations')).map(
          rect
        ),
        segments: Array.from(root.querySelectorAll<HTMLElement>('.segment-annotations')).map(each =>
          rect(each.closest('.chord-segment') as Element)
        ),
        chords: Array.from(root.querySelectorAll('.chord:not(.chord-empty)')).map(each =>
          rect(each.querySelector('chord-display') ?? each)
        ),
        lyrics: Array.from(root.querySelectorAll('.lyrics')).map(rect),
      }
    }

    it('sit level with the chords, after the chord at their word, and overlap none', async () => {
      const { line, annotations, chords, lyrics } = await laidOut(wide, [[8, 'build']])
      expect(line.classList.contains('annotations-on-chords')).to.equal(true)
      expect(line.classList.contains('has-annotations')).to.equal(false)
      const [at] = annotations
      const [, second] = chords // C, over "grace"
      // level with the chord row: no lower than the chords, and above the lyrics
      expect(at.top).to.be.at.least(chords[0].top - 3)
      expect(at.bottom).to.be.at.most(lyrics[0].top + 2)
      expect(at.left).to.be.at.least(second.right - 1)
      for (const chord of chords)
        expect(at.left >= chord.right - 1 || at.right <= chord.left + 1).to.equal(true)
    })

    it('stay at their word when it has no chord', async () => {
      const chart = new ChordProParser().parse(
        '{title: A}\n{key: G}\n\n{comment: Verse}\n[G]Amazing grace how [D]sweet'
      )
      const { annotations, segments } = await laidOut(chart, [[14, 'build']])
      // (the word is a piece of the line of its own, and the annotation starts where it does)
      expect(Math.abs(annotations[0].left - segments[0].left)).to.be.lessThan(2)
    })

    it('push the next chord right by what they need, and no more, and it comes back with them gone', async () => {
      const without = await laidOut(wide, [])
      const idle = without.chords[2].left
      const some = await laidOut(wide, [[8, 'softly, pad only']])
      const [at] = some.annotations
      const [, , next] = some.chords
      expect(next.left).to.be.greaterThan(idle + 5)
      // (it clears the chord with the gap that was asked for, not by a lot more)
      expect(at.right).to.be.at.most(next.left)
      expect(next.left - at.right).to.be.lessThan(14)
      const short = await laidOut(wide, [[8, 'ok']])
      expect(short.chords[2].left).to.be.closeTo(idle, 1)
    })

    it('spend no height: the line is about as tall as it is without them', async () => {
      // (wide enough that nothing wraps: a push that makes a line wrap does cost a row)
      const without = await laidOut(wide, [], { width: 600 })
      const some = await laidOut(
        wide,
        [
          [8, 'softly'],
          [0, 'quiet'],
        ],
        { width: 600 }
      )
      expect(some.lineRect.height - without.lineRect.height).to.be.lessThan(8)
      expect(some.lineRect.height).to.be.at.least(without.lineRect.height)
    })

    it('keep a row of their own where the chords are hidden, or the line has none', async () => {
      const hidden = await laidOut(wide, [[8, 'build']], { hide: 'chords' })
      expect(hidden.line.classList.contains('has-annotations')).to.equal(true)
      expect(hidden.line.classList.contains('annotations-on-chords')).to.equal(false)
      const lyricsOnly = new ChordProParser().parse(
        '{title: A}\n{key: G}\n\n{comment: Verse}\nAmazing grace how sweet'
      )
      const plain = await laidOut(lyricsOnly, [[8, 'build']])
      expect(plain.line.classList.contains('has-annotations')).to.equal(true)
      expect(plain.line.classList.contains('annotations-on-chords')).to.equal(false)
      expect(plain.annotations[0].bottom).to.be.at.most(plain.lyrics[0].top + 1)
    })

    it('keep their own row, one higher for each that cannot share it, and wrap one wider than the line', async () => {
      const { line, annotations } = await laidOut(
        wide,
        [
          [0, 'quietly at first'],
          [8, 'then build up slowly'],
          [14, 'all drop out'],
        ],
        { width: 300, hide: 'chords' }
      )
      expect(line.style.getPropertyValue('--annotation-rows')).to.equal('2')
      expect(new Set(annotations.map(each => Math.round(each.top))).size).to.equal(2)
      const long =
        'an annotation much too long to fit on a line of a narrow phone at all, it goes over more lines'
      const wrapped = await laidOut(wide, [[8, long]], { width: 300, hide: 'chords' })
      expect(wrapped.annotations[0].width).to.be.at.most(wrapped.lineRect.width + 1)
      expect(wrapped.annotations[0].height).to.be.greaterThan(annotations[0].height * 1.5)
    })

    it('share the row where only the chords are shown', async () => {
      const { line, annotations, chords } = await laidOut(wide, [[8, 'build']], { hide: 'lyrics' })
      expect(line.classList.contains('annotations-on-chords')).to.equal(true)
      expect(annotations[0].top).to.be.at.least(chords[0].top - 3)
    })

    it('go in a row above only when they cannot fit, and make room for it', async () => {
      const long = 'an annotation much too long to fit on the chord row of a narrow phone at all'
      const { line, annotations, chords } = await laidOut(wide, [[8, long]], { width: 300 })
      // (as many rows as the annotation has lines, set in the line's width)
      expect(Number(line.style.getPropertyValue('--annotation-above'))).to.be.at.least(1)
      expect(annotations[0].bottom).to.be.at.most(chords[0].top + 1)
      expect(annotations[0].top).to.be.at.least(line.getBoundingClientRect().top - 1)
      const plain = await laidOut(wide, [[8, 'short']])
      expect(plain.line.style.getPropertyValue('--annotation-above')).to.equal('')
    })

    it('are laid out again, and the chords pulled back, when the line is widened', async () => {
      const { line, annotations, chords } = await laidOut(wide, [[8, 'softly, pad only']], {
        width: 200,
      })
      const wrapper = (line.getRootNode() as ShadowRoot).host
      const host = (wrapper.getRootNode() as ShadowRoot).host.parentElement as HTMLElement
      host.style.width = '500px'
      await frames()
      expect(annotations[0].right).to.be.at.most(line.getBoundingClientRect().right + 1)
      const again = Array.from(
        (line.getRootNode() as ShadowRoot).querySelectorAll('.chord:not(.chord-empty)')
      )
      expect(again.length).to.equal(chords.length)
    })
  })

  describe('in edit mode', () => {
    const labelled = new ChordProParser().parse(
      '{title: A}\n{key: G}\n\n{comment: Verse}\n[G]Amazing [C]grace how sweet'
    )
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    async function editing(withAnnotations = noSources()) {
      const display = await fixture<SongDisplay>(html`<song-display></song-display>`)
      display.parsed = labelled
      display.songIndex = 3
      display.annotations = annotationsBySection(labelled.sections, withAnnotations)
      await display.updateComplete
      const section = display.shadowRoot?.querySelector('song-section') as SongSection
      section.editMode = true
      await section.updateComplete
      const requests: AnnotationRequestEvent[] = []
      display.addEventListener(AnnotationRequestEvent.type, event =>
        requests.push(event as AnnotationRequestEvent)
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

    it('asks for the annotation editor when a word or the title is held', async () => {
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
          each.annotationId,
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

    it('does not ask for the editor from a key pressed somewhere that is not a place for one', async () => {
      const { root, requests } = await editing()
      const content = root.querySelector('.section-content') as HTMLElement
      content.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ContextMenu',
          bubbles: true,
          composed: true,
          cancelable: true,
        })
      )
      expect(requests).to.deep.equal([])
    })

    it('asks for the editor on an annotation that is tapped, with its id, and does not collapse the section', async () => {
      let sources = putAnnotation(
        noSources(),
        makeAnnotation('spot', textAnchor(labelled.sections, 0, 0, 8)),
        'private'
      )
      sources = putAnnotation(
        sources,
        makeAnnotation('head', sectionAnchor(labelled.sections, 0)),
        'private'
      )
      const { root, section, requests } = await editing(sources)
      let toggled = 0
      section.addEventListener('song-section:toggle', () => toggled++)
      ;(root.querySelector('.segment-annotations .annotation') as HTMLElement).click()
      ;(root.querySelector('.section-title-wrapper .annotation') as HTMLElement).click()
      expect(
        requests.map(each => [each.place, each.annotationId, each.line, each.offset])
      ).to.deep.equal([
        ['text', 'spot', 0, 8],
        ['title', 'head', 0, 0],
      ])
      expect(toggled).to.equal(0)
    })

    it('does nothing for a hold or a tap when not editing', async () => {
      const sources = putAnnotation(
        noSources(),
        makeAnnotation('spot', textAnchor(labelled.sections, 0, 0, 8)),
        'private'
      )
      const { section, root, requests } = await editing(sources)
      section.editMode = false
      await section.updateComplete
      press(root.querySelectorAll('.chord-segment')[1] as Element)
      await wait(650)
      ;(root.querySelector('.segment-annotations .annotation') as HTMLElement).click()
      expect(requests).to.deep.equal([])
      expect(root.querySelector('.chord-segment')?.hasAttribute('tabindex')).to.equal(false)
    })

    it('has a place in the song’s strip for an annotation on the whole song, and one to start it', async () => {
      document.body.classList.add('edit-mode')
      try {
        const sources = putAnnotation(
          noSources(),
          makeAnnotation('whole', { kind: 'song' }),
          'private'
        )
        const { display, requests } = await editing(sources)
        await display.updateComplete
        const strip = display.shadowRoot as ShadowRoot
        ;(strip.querySelector('.song-annotations .annotation') as HTMLElement).click()
        ;(strip.querySelector('.add-song-annotation') as HTMLElement).click()
        // (what is in the strip but is not an annotation does nothing)
        ;(strip.querySelector('.song-annotations') as HTMLElement).click()
        expect(requests.map(each => [each.place, each.annotationId, each.songIndex])).to.deep.equal(
          [
            ['song', 'whole', 3],
            ['song', undefined, 3],
          ]
        )
      } finally {
        document.body.classList.remove('edit-mode')
      }
    })

    it('leaves a song’s strip alone when not editing: taps do nothing, and with no annotations there is none', async () => {
      const sources = putAnnotation(
        noSources(),
        makeAnnotation('whole', { kind: 'song' }),
        'private'
      )
      const { display, requests } = await editing(sources)
      ;(
        (display.shadowRoot as ShadowRoot).querySelector(
          '.song-annotations .annotation'
        ) as HTMLElement
      ).click()
      expect(requests).to.deep.equal([])
      expect(display.shadowRoot?.querySelector('.add-song-annotation')).to.equal(null)
      display.annotations = annotationsBySection(labelled.sections, noSources())
      await display.updateComplete
      expect(display.shadowRoot?.querySelector('.song-annotations')).to.equal(null)
    })
  })
})
