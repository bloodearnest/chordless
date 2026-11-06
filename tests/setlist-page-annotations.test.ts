/**
 * The annotations on the setlist page (src/js/setlist/annotations-controller.ts): a request for the editor from
 * a spot on a chart opens it, and what it answers is kept where the annotation's kind says and drawn.
 * How the editor looks is in annotation-editor.test.ts; a hold becoming a request in chart-annotations-display.test.ts.
 */
import { expect, waitUntil } from '@open-wc/testing'
import type { AnnotationEditor } from '../src/components/annotation-editor.ts'
import type { SongDisplay } from '../src/components/song-display.ts'
import { AnnotationRequestEvent, type SongSection } from '../src/components/song-section.ts'
import type { ChartAnnotation, SharedChartAnnotation } from '../src/js/data-types.ts'
import { setAnnotationsPreference } from '../src/js/preferences.ts'
import { loadSetlistAnnotations, saveSetlistAnnotations } from '../src/js/setlist/local-state.ts'
import { makeEntry } from './builders.ts'
import { must, useSetlistPage } from './setlist-page-harness.ts'
import { clearToasts, shownToast } from './test-helpers.ts'

const { describe, it, afterEach } = window

describe('the setlist page: annotations', () => {
  const rig = useSetlistPage()
  afterEach(async () => {
    clearToasts()
    setAnnotationsPreference('shared', true)
    setAnnotationsPreference('mine', true)
  })

  const display = (index = 0) => must(rig.$<SongDisplay>(`#song-${index} song-display`))
  const section = (index = 0, songIndex = 0) =>
    must(display(songIndex).shadowRoot?.querySelectorAll<SongSection>('song-section')[index])
  /** The annotations drawn on a song, in its sections and above them */
  const annotationElements = (index = 0) => {
    const root = must(display(index).shadowRoot)
    return [
      ...root.querySelectorAll('.song-annotations .annotation'),
      ...Array.from(root.querySelectorAll<SongSection>('song-section')).flatMap(each => [
        ...(each.shadowRoot?.querySelectorAll('.annotation') ?? []),
      ]),
    ]
  }
  const shown = (index = 0) =>
    annotationElements(index).map(each => ({
      text: each.textContent,
      shared: each.classList.contains('shared'),
    }))
  const firstAnnotationId = () =>
    must(annotationElements()[0]).getAttribute('data-annotation-id') as string

  /** What a hold in edit mode asks for, from the song's section */
  type Where = ConstructorParameters<typeof AnnotationRequestEvent>[1]
  function ask(where: Where, { song = 0, sectionIndex = 0 } = {}) {
    const target = section(sectionIndex, song)
    target.dispatchEvent(
      new AnnotationRequestEvent({ songIndex: song, sectionIndex }, where, target)
    )
  }

  const editor = () => must(rig.root.querySelector<AnnotationEditor>('annotation-editor'))
  const editorRoot = () => must(editor().shadowRoot)

  /** Wait for the editor to be open, and do something in it */
  async function inEditor(use: (root: ShadowRoot) => void) {
    await waitUntil(
      () =>
        rig.root
          .querySelector<AnnotationEditor>('annotation-editor')
          ?.shadowRoot?.querySelector('dialog')?.open,
      'the editor opens'
    )
    use(editorRoot())
    await editor().updateComplete
  }
  const press = (root: ShadowRoot, label: string) => {
    const button = Array.from(root.querySelectorAll('button')).find(
      each => each.textContent?.trim() === label
    )
    must(button).click()
  }
  const choose = (root: ShadowRoot, label: string) => {
    const radio = Array.from(root.querySelectorAll('label'))
      .find(each => each.textContent?.trim() === label)
      ?.querySelector('input')
    must(radio).click()
  }
  const write = (root: ShadowRoot, text: string) => {
    const field = must(root.querySelector('textarea'))
    field.value = text
    field.dispatchEvent(new Event('input'))
  }
  /** Make an annotation on a spot and wait until it is drawn */
  async function make(
    where: Where,
    text: string,
    use: (root: ShadowRoot) => void = () => {},
    at?: Parameters<typeof ask>[1]
  ) {
    ask(where, at)
    await inEditor(root => {
      write(root, text)
      use(root)
      press(root, 'Done')
    })
    await waitUntil(() => !editorRoot().querySelector('dialog')?.open)
    await rig.flush()
  }

  const word = { place: 'text' as const, line: 0, offset: 9 }

  it('opens the editor on a word, and keeps an annotation as the user’s own, for this setlist, where it is drawn', async () => {
    const setlist = await rig.open(2)
    ask(word)
    await inEditor(root => {
      expect(root.querySelector('h2')?.textContent).to.contain('New annotation on “grace”')
      write(root, 'softly')
      press(root, 'Done')
    })
    await rig.flush()

    expect(shown()).to.deep.equal([{ text: 'softly', shared: false }])
    const annotations = loadSetlistAnnotations(setlist.id, {
      songId: rig.songs[0].id,
      songUuid: rig.songs[0].uuid,
    })
    expect(annotations).to.have.length(1)
    // (found by the word it is on, whatever the chords: the offset was snapped to the word's start)
    expect(annotations[0].anchor).to.include({ kind: 'text', line: 0, offset: 8 })
    // Not in the setlist, which is shared
    expect(must(await rig.db.getSetlist(setlist.id)).songs[0].annotations).to.equal(undefined)
  })

  it('keeps an annotation for everyone in the setlist, without drawing the page again', async () => {
    const setlist = await rig.open(2)
    const before = display()
    await make({ place: 'title' }, 'all in', root => choose(root, 'Everyone'))

    expect(display()).to.equal(before)
    expect(shown()).to.deep.equal([{ text: 'all in', shared: true }])
    const saved = must(await rig.db.getSetlist(setlist.id)).songs[0]
      .annotations as SharedChartAnnotation[]
    expect(saved.map(annotation => [annotation.anchor, annotation.body])).to.deep.equal([
      [
        { kind: 'section', label: 'Verse 1', nth: 0, sectionHead: 'Amazing grace' },
        { kind: 'text', text: 'all in' },
      ],
    ])
    expect(must(rig.page.currentSetlist).songs[0].annotations).to.have.length(1)
  })

  it('keeps an annotation on the whole song, for this setlist, above the sections', async () => {
    const first = rig.songs[0]
    const entry = (order: number) =>
      makeEntry({ order, songId: first.id, songUuid: first.uuid, key: 'G' })
    await rig.open(0, { songs: [entry(0), entry(1)] })
    await make({ place: 'song' }, 'capo 2')

    expect(
      Array.from(
        display(0).shadowRoot?.querySelectorAll('.song-annotations .annotation') ?? []
      ).map(each => each.textContent)
    ).to.deep.equal(['capo 2'])
    // (the same song again in the setlist is another place for it: it has its own)
    expect(shown(1)).to.deep.equal([])
  })

  it('edits an annotation that is there, and moves it between kinds keeping its place', async () => {
    const setlist = await rig.open(1)
    await make(word, 'softly')
    const id = firstAnnotationId()
    expect(id).to.be.a('string')

    ask({ place: 'text', line: 0, offset: 8, annotationId: id }, {})
    await inEditor(root => {
      expect(must(root.querySelector('textarea')).value).to.equal('softly')
      expect(root.querySelector('h2')?.textContent).to.contain('Annotation on')
      write(root, 'very softly')
      choose(root, 'Everyone')
      press(root, 'Done')
    })
    await waitUntil(() => !editorRoot().querySelector('dialog')?.open)
    await rig.flush()

    expect(shown()).to.deep.equal([{ text: 'very softly', shared: true }])
    expect(
      loadSetlistAnnotations(setlist.id, { songId: rig.songs[0].id, songUuid: rig.songs[0].uuid })
    ).to.deep.equal([])
    expect(
      must(await rig.db.getSetlist(setlist.id)).songs[0].annotations?.map(
        annotation => annotation.id
      )
    ).to.deep.equal([id])
  })

  it('deletes an annotation, and puts it back with Undo', async () => {
    await rig.open(1)
    await make(word, 'softly')
    const id = firstAnnotationId()

    ask({ place: 'text', line: 0, offset: 8, annotationId: id })
    await inEditor(root => press(root, 'Delete'))
    await waitUntil(() => shown().length === 0)
    expect(shownToast()?.message).to.equal('Annotation deleted')

    must(shownToast()?.action).run()
    await rig.flush()
    expect(shown()).to.deep.equal([{ text: 'softly', shared: false }])
  })

  it('makes no annotation of nothing, and none when cancelled, and deletes one whose text is cleared', async () => {
    await rig.open(1)
    await make(word, '   ')
    expect(shown()).to.deep.equal([])

    ask(word)
    await inEditor(root => {
      write(root, 'nope')
      press(root, 'Cancel')
    })
    await waitUntil(() => !editorRoot().querySelector('dialog')?.open)
    expect(shown()).to.deep.equal([])

    await make(word, 'softly')
    const id = firstAnnotationId()
    ask({ ...word, annotationId: id })
    await inEditor(root => {
      write(root, '')
      press(root, 'Done')
    })
    await waitUntil(() => shown().length === 0)
  })

  it('says so, and keeps the annotations as they were, when an annotation could not be saved', async () => {
    await rig.open(1)
    const real = rig.page.setAnnotations.bind(rig.page)
    rig.page.setAnnotations = async () => {
      throw new Error('the disk is full')
    }
    try {
      await make(word, 'softly', root => choose(root, 'Everyone'))
      await waitUntil(() => shownToast()?.kind === 'error')
      expect(shownToast()?.details).to.contain('the disk is full')
      expect(shown()).to.deep.equal([])
    } finally {
      rig.page.setAnnotations = real
    }
  })

  it('does nothing for a song or a section that is not there, nor for a drawing', async () => {
    const setlist = await rig.open(1)
    expect(rig.page.annotations.chartAnnotations(9)).to.equal(null)
    // (the section is looked for as it is sent from: the page draws it again below)
    const send = (songIndex: number, sectionIndex: number, annotationId?: string) => {
      const target = section()
      target.dispatchEvent(
        new AnnotationRequestEvent(
          { songIndex, sectionIndex },
          { place: 'text', annotationId },
          target
        )
      )
    }
    send(9, 0)
    const ink: ChartAnnotation = {
      id: 'ink1',
      anchor: { kind: 'song' },
      body: { kind: 'ink', strokes: [], w: 1, h: 1 },
      modified: '',
    }
    saveSetlistAnnotations(
      setlist.id,
      { songId: rig.songs[0].id, songUuid: rig.songs[0].uuid },
      [ink],
      setlist.songs.map(entry => ({ songId: entry.songId, songUuid: entry.songUuid }))
    )
    await rig.page.renderSetlist(setlist.id)
    await rig.flush()
    send(0, 0, 'ink1')
    await rig.flush()
    expect(rig.root.querySelector('annotation-editor')).to.equal(null)
    expect(shown()).to.deep.equal([])

    // (a spot in a section the chart does not have is an annotation on the song, said of the line)
    send(0, 9)
    await inEditor(root => {
      expect(root.querySelector('h2')?.textContent).to.contain('this line')
      write(root, 'somewhere')
      press(root, 'Done')
    })
    await waitUntil(() => shown().length > 0)
    expect(shown()).to.deep.equal([{ text: 'somewhere', shared: false }])
  })

  it('names what an annotation is on: a title, a word, a line, a section without a name', async () => {
    await rig.open(1)
    const heading = async (where: Where, at?: Parameters<typeof ask>[1]) => {
      ask(where, at)
      let text = ''
      await inEditor(root => {
        text = root.querySelector('h2')?.textContent ?? ''
        press(root, 'Cancel')
      })
      await waitUntil(() => !editorRoot().querySelector('dialog')?.open)
      return text
    }
    expect(await heading({ place: 'title' })).to.contain('“Verse 1”')
    expect(await heading({ place: 'song' })).to.contain('the whole song')
    expect(await heading({ place: 'text', line: 0, offset: 0 })).to.contain('“Amazing”')
    expect(await heading({ place: 'text', line: 9, offset: 0 })).to.contain('this line')
  })

  it('draws the annotations the preferences choose, and all of them while editing', async () => {
    await rig.open(1)
    await make({ place: 'title' }, 'team', root => choose(root, 'Everyone'))
    await make(word, 'mine')
    expect(shown().map(annotation => annotation.text)).to.have.members(['team', 'mine'])

    setAnnotationsPreference('shared', false)
    await rig.flush()
    expect(shown().map(annotation => annotation.text)).to.deep.equal(['mine'])
    setAnnotationsPreference('mine', false)
    await rig.flush()
    expect(shown()).to.deep.equal([])

    document.body.classList.add('edit-mode')
    rig.page.annotations.refreshAll()
    await rig.flush()
    expect(shown().map(annotation => annotation.text)).to.have.members(['team', 'mine'])
  })

  it('reads the annotations of the setlist again when it is drawn again', async () => {
    const setlist = await rig.open(1)
    await make({ place: 'title' }, 'team', root => choose(root, 'Everyone'))
    await rig.page.renderSetlist(setlist.id)
    await rig.flush()
    expect(shown()).to.deep.equal([{ text: 'team', shared: true }])
  })

  it('lets the user share annotations unless the setlist was received, or they cannot edit the space', async () => {
    await rig.open(1)
    expect(await rig.page.canShare()).to.equal(true)
    await rig.open(1, {
      received: { fileId: 'f', key: 'k', etag: 'e', expires: '2099-01-01' },
    })
    expect(await rig.page.canShare()).to.equal(false)
  })

  it('keeps a shared annotation on a song with setAnnotations, which a sync then carries', async () => {
    const setlist = await rig.open(2)
    const annotation: ChartAnnotation & { body: { kind: 'text'; text: string } } = {
      id: 'n1',
      anchor: { kind: 'song' },
      body: { kind: 'text', text: 'hello' },
      modified: '',
    }
    await rig.page.setAnnotations(1, [annotation])
    expect(must(await rig.db.getSetlist(setlist.id)).songs[1].annotations).to.deep.equal([
      annotation,
    ])
    await rig.page.setAnnotations(1, [])
    expect('annotations' in must(await rig.db.getSetlist(setlist.id)).songs[1]).to.equal(false)
  })

  describe('when the chart is fixed', () => {
    /** The chart of the first song, with a line added above the one the annotations are on */
    async function addALineAbove() {
      const song = must(await rig.db.getSong(rig.songs[0].uuid))
      const chart = must(await rig.db.getChordPro(song.chordproFileId))
      await rig.db.saveChordPro({
        ...chart,
        content: chart.content.replace(
          '{comment: Verse 1}\n',
          '{comment: Verse 1}\nA brand new line\n'
        ),
      })
      return chart
    }
    const restore = async (chart: Awaited<ReturnType<typeof addALineAbove>>) =>
      rig.db.saveChordPro(chart)
    const ref = () => ({ songId: rig.songs[0].id, songUuid: rig.songs[0].uuid })

    it('follows its line, and the user’s own is kept up to date on this device', async () => {
      const setlist = await rig.open(1)
      await make(word, 'softly')
      const original = await addALineAbove()
      await rig.page.renderSetlist(setlist.id)
      await rig.flush()

      expect(shown()).to.deep.equal([{ text: 'softly', shared: false }])
      const [kept] = loadSetlistAnnotations(setlist.id, ref())
      expect(kept.anchor).to.include({ kind: 'text', line: 1, offset: 8 })
      // and it finds its place for the chart as it is, not as it was
      await restore(original)
      await rig.page.renderSetlist(setlist.id)
      await rig.flush()
      expect(loadSetlistAnnotations(setlist.id, ref())[0].anchor).to.include({ line: 0, offset: 8 })
    })

    it('shared with everyone is found the same way, and kept up to date by the one who can write when they finish editing', async () => {
      const setlist = await rig.open(1)
      await make(word, 'band drops', root => choose(root, 'Everyone'))
      await addALineAbove()
      await rig.page.renderSetlist(setlist.id)
      await rig.flush()
      expect(shown()).to.deep.equal([{ text: 'band drops', shared: true }])

      // (finding it again writes nothing: the setlist is as it was)
      const stored = async () =>
        must(await rig.db.getSetlist(setlist.id)).songs[0].annotations?.[0]?.anchor
      expect(await stored()).to.include({ line: 0 })
      await rig.page.annotations.healShared()
      expect(await stored()).to.include({ line: 1, offset: 8 })
    })

    it('says nothing, and carries on, when where an annotation is cannot be kept', async () => {
      const setlist = await rig.open(1)
      await make(word, 'band drops', root => choose(root, 'Everyone'))
      await addALineAbove()
      await rig.page.renderSetlist(setlist.id)
      const real = rig.page.setAnnotations.bind(rig.page)
      rig.page.setAnnotations = async () => {
        throw new Error('the disk is full')
      }
      try {
        await rig.page.annotations.healShared()
      } finally {
        rig.page.setAnnotations = real
      }
      expect(rig.errors.some(args => String(args[0]).includes('Could not keep where'))).to.equal(
        true
      )
      expect(shownToast()).to.equal(null)
    })

    it('shared with everyone is not written by one who cannot write the setlist', async () => {
      const entry = makeEntry({
        order: 0,
        songId: rig.songs[0].id,
        songUuid: rig.songs[0].uuid,
        key: 'G',
      })
      entry.annotations = [
        {
          id: 'a1',
          anchor: {
            kind: 'text',
            label: 'Verse 1',
            nth: 0,
            line: 0,
            offset: 8,
            before: 'Amazing ',
            after: 'grace',
          },
          body: { kind: 'text', text: 'from the leader' },
          modified: '',
        },
      ]
      await addALineAbove()
      const setlist = await rig.open(0, {
        songs: [entry],
        received: { fileId: 'f', key: 'k', etag: 'e', expires: '2099-01-01' },
      })
      expect(shown()).to.deep.equal([{ text: 'from the leader', shared: true }])
      await rig.page.annotations.healShared()
      const stored = must(await rig.db.getSetlist(setlist.id)).songs[0].annotations?.[0]
      expect(stored?.anchor).to.include({ line: 0 })
    })
  })
})
