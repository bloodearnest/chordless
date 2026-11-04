/**
 * The notes on the setlist page (src/js/setlist/notes-controller.ts): a request for the editor from
 * a spot on a chart opens it, and what it answers is kept where the note's kind says and drawn.
 * How the editor looks is in note-editor.test.ts; a hold becoming a request in chart-notes-display.test.ts.
 */
import { expect, waitUntil } from '@open-wc/testing'
import type { NoteEditor } from '../src/components/note-editor.ts'
import type { SongDisplay } from '../src/components/song-display.ts'
import { NoteRequestEvent, type SongSection } from '../src/components/song-section.ts'
import type { ChartNote, SharedChartNote } from '../src/js/data-types.ts'
import { setNotesPreference } from '../src/js/preferences.ts'
import { loadSetlistNotes } from '../src/js/setlist/local-state.ts'
import { makeEntry } from './builders.ts'
import { must, useSetlistPage } from './setlist-page-harness.ts'
import { clearToasts, shownToast } from './test-helpers.ts'

const { describe, it, afterEach } = window

describe('the setlist page: notes', () => {
  const rig = useSetlistPage()
  afterEach(async () => {
    // (the library's notes are for the song, so they outlast the setlist)
    for (const each of rig.songs) await rig.db.saveSongNotes(each.id, [])
    clearToasts()
    setNotesPreference('shared', true)
    setNotesPreference('mine', true)
  })

  const display = (index = 0) => must(rig.$<SongDisplay>(`#song-${index} song-display`))
  const section = (index = 0, songIndex = 0) =>
    must(display(songIndex).shadowRoot?.querySelectorAll<SongSection>('song-section')[index])
  /** The notes drawn on a song, in its sections and above them */
  const noteElements = (index = 0) => {
    const root = must(display(index).shadowRoot)
    return [
      ...root.querySelectorAll('.song-notes .note'),
      ...Array.from(root.querySelectorAll<SongSection>('song-section')).flatMap(each => [
        ...(each.shadowRoot?.querySelectorAll('.note') ?? []),
      ]),
    ]
  }
  const shown = (index = 0) =>
    noteElements(index).map(each => ({
      text: each.textContent,
      shared: each.classList.contains('shared'),
    }))
  const firstNoteId = () => must(noteElements()[0]).getAttribute('data-note-id') as string

  /** What a hold in edit mode asks for, from the song's section */
  type Where = ConstructorParameters<typeof NoteRequestEvent>[1]
  function ask(where: Where, { song = 0, sectionIndex = 0 } = {}) {
    const target = section(sectionIndex, song)
    target.dispatchEvent(new NoteRequestEvent({ songIndex: song, sectionIndex }, where, target))
  }

  const editor = () => must(rig.root.querySelector<NoteEditor>('note-editor'))
  const editorRoot = () => must(editor().shadowRoot)

  /** Wait for the editor to be open, and do something in it */
  async function inEditor(use: (root: ShadowRoot) => void) {
    await waitUntil(
      () =>
        rig.root.querySelector<NoteEditor>('note-editor')?.shadowRoot?.querySelector('dialog')
          ?.open,
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
  /** Make a note on a spot and wait until it is drawn */
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

  it('opens the editor on a word, and keeps a note as the user’s own, for this setlist, where it is drawn', async () => {
    const setlist = await rig.open(2)
    ask(word)
    await inEditor(root => {
      expect(root.querySelector('h2')?.textContent).to.contain('New note on “grace”')
      write(root, 'softly')
      press(root, 'Done')
    })
    await rig.flush()

    expect(shown()).to.deep.equal([{ text: 'softly', shared: false }])
    const notes = loadSetlistNotes(setlist.id, {
      songId: rig.songs[0].id,
      songUuid: rig.songs[0].uuid,
    })
    expect(notes).to.have.length(1)
    // (found by the word it is on, whatever the chords: the offset was snapped to the word's start)
    expect(notes[0].anchor).to.include({ kind: 'text', line: 0, offset: 8 })
    // Not in the setlist, which is shared, nor for the song
    expect(must(await rig.db.getSetlist(setlist.id)).songs[0].annotations).to.equal(undefined)
    expect(await rig.db.getSongNotes(rig.songs[0].id)).to.deep.equal([])
  })

  it('keeps a note for the team in the setlist, without drawing the page again', async () => {
    const setlist = await rig.open(2)
    const before = display()
    await make({ place: 'title' }, 'all in', root => choose(root, 'The team'))

    expect(display()).to.equal(before)
    expect(shown()).to.deep.equal([{ text: 'all in', shared: true }])
    const saved = must(await rig.db.getSetlist(setlist.id)).songs[0]
      .annotations as SharedChartNote[]
    expect(saved.map(note => [note.anchor, note.body])).to.deep.equal([
      [
        { kind: 'section', label: 'Verse 1', nth: 0 },
        { kind: 'text', text: 'all in' },
      ],
    ])
    expect(must(rig.page.currentSetlist).songs[0].annotations).to.have.length(1)
  })

  it('keeps a note for the song in the library, for every place the song is in the setlist, and on the whole song', async () => {
    const [first] = rig.songs
    const entry = (order: number) =>
      makeEntry({ order, songId: first.id, songUuid: first.uuid, key: 'G' })
    await rig.open(0, { songs: [entry(0), entry(1)] })
    await make({ place: 'song' }, 'capo 2', root => choose(root, 'Always, this song'))

    expect(await rig.db.getSongNotes(first.id)).to.have.length(1)
    expect(shown(0)).to.deep.equal([{ text: 'capo 2', shared: false }])
    // (the song is there twice)
    expect(shown(1)).to.deep.equal([{ text: 'capo 2', shared: false }])
    expect(
      Array.from(display(0).shadowRoot?.querySelectorAll('.song-notes .note') ?? []).map(
        each => each.textContent
      )
    ).to.deep.equal(['capo 2'])
  })

  it('edits a note that is there, and moves it between kinds keeping its place', async () => {
    const setlist = await rig.open(1)
    await make(word, 'softly')
    const id = firstNoteId()
    expect(id).to.be.a('string')

    ask({ place: 'text', line: 0, offset: 8, noteId: id }, {})
    await inEditor(root => {
      expect(must(root.querySelector('textarea')).value).to.equal('softly')
      expect(root.querySelector('h2')?.textContent).to.contain('Note on')
      write(root, 'very softly')
      choose(root, 'The team')
      press(root, 'Done')
    })
    await waitUntil(() => !editorRoot().querySelector('dialog')?.open)
    await rig.flush()

    expect(shown()).to.deep.equal([{ text: 'very softly', shared: true }])
    expect(
      loadSetlistNotes(setlist.id, { songId: rig.songs[0].id, songUuid: rig.songs[0].uuid })
    ).to.deep.equal([])
    expect(
      must(await rig.db.getSetlist(setlist.id)).songs[0].annotations?.map(note => note.id)
    ).to.deep.equal([id])
  })

  it('deletes a note, and puts it back with Undo', async () => {
    await rig.open(1)
    await make(word, 'softly')
    const id = firstNoteId()

    ask({ place: 'text', line: 0, offset: 8, noteId: id })
    await inEditor(root => press(root, 'Delete'))
    await waitUntil(() => shown().length === 0)
    expect(shownToast()?.message).to.equal('Note deleted')

    must(shownToast()?.action).run()
    await rig.flush()
    expect(shown()).to.deep.equal([{ text: 'softly', shared: false }])
  })

  it('makes no note of nothing, and none when cancelled, and deletes one whose text is cleared', async () => {
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
    const id = firstNoteId()
    ask({ ...word, noteId: id })
    await inEditor(root => {
      write(root, '')
      press(root, 'Done')
    })
    await waitUntil(() => shown().length === 0)
  })

  it('says so, and keeps the notes as they were, when a note could not be saved', async () => {
    await rig.open(1)
    const real = rig.db.saveSongNotes.bind(rig.db)
    rig.db.saveSongNotes = async () => {
      throw new Error('the disk is full')
    }
    try {
      await make(word, 'softly', root => choose(root, 'Always, this song'))
      await waitUntil(() => shownToast()?.kind === 'error')
      expect(shownToast()?.details).to.contain('the disk is full')
      expect(shown()).to.deep.equal([])
    } finally {
      rig.db.saveSongNotes = real
    }
  })

  it('does nothing for a song or a section that is not there, nor for a drawing', async () => {
    const setlist = await rig.open(1)
    expect(rig.page.notes.chartNotes(9)).to.equal(null)
    // (the section is looked for as it is sent from: the page draws it again below)
    const send = (songIndex: number, sectionIndex: number, noteId?: string) => {
      const target = section()
      target.dispatchEvent(
        new NoteRequestEvent({ songIndex, sectionIndex }, { place: 'text', noteId }, target)
      )
    }
    send(9, 0)
    const ink: ChartNote = {
      id: 'ink1',
      anchor: { kind: 'song' },
      body: { kind: 'ink', strokes: [], w: 1, h: 1 },
      modified: '',
    }
    await rig.db.saveSongNotes(rig.songs[0].id, [ink])
    await rig.page.renderSetlist(setlist.id)
    await rig.flush()
    send(0, 0, 'ink1')
    await rig.flush()
    expect(rig.root.querySelector('note-editor')).to.equal(null)
    expect(shown()).to.deep.equal([])

    // (a spot in a section the chart does not have is a note on the song, said of the line)
    send(0, 9)
    await inEditor(root => {
      expect(root.querySelector('h2')?.textContent).to.contain('this line')
      write(root, 'somewhere')
      press(root, 'Done')
    })
    await waitUntil(() => shown().length > 0)
    expect(shown()).to.deep.equal([{ text: 'somewhere', shared: false }])
  })

  it('names what a note is on: a title, a word, a line, a section without a name', async () => {
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

  it('draws the notes the preferences choose, and all of them while editing', async () => {
    await rig.open(1)
    await make({ place: 'title' }, 'team', root => choose(root, 'The team'))
    await make(word, 'mine')
    expect(shown().map(note => note.text)).to.have.members(['team', 'mine'])

    setNotesPreference('shared', false)
    await rig.flush()
    expect(shown().map(note => note.text)).to.deep.equal(['mine'])
    setNotesPreference('mine', false)
    await rig.flush()
    expect(shown()).to.deep.equal([])

    document.body.classList.add('edit-mode')
    rig.page.notes.refreshAll()
    await rig.flush()
    expect(shown().map(note => note.text)).to.have.members(['team', 'mine'])
  })

  it('reads the notes of the setlist again when it is drawn again', async () => {
    const setlist = await rig.open(1)
    await make({ place: 'title' }, 'team', root => choose(root, 'The team'))
    await rig.page.renderSetlist(setlist.id)
    await rig.flush()
    expect(shown()).to.deep.equal([{ text: 'team', shared: true }])
  })

  it('lets the user share notes unless the setlist was received, or they cannot edit the space', async () => {
    await rig.open(1)
    expect(await rig.page.canShare()).to.equal(true)
    await rig.open(1, {
      received: { fileId: 'f', key: 'k', etag: 'e', expires: '2099-01-01' },
    })
    expect(await rig.page.canShare()).to.equal(false)
  })

  it('keeps a shared note on a song with setAnnotations, which a sync then carries', async () => {
    const setlist = await rig.open(2)
    const note: ChartNote & { body: { kind: 'text'; text: string } } = {
      id: 'n1',
      anchor: { kind: 'song' },
      body: { kind: 'text', text: 'hello' },
      modified: '',
    }
    await rig.page.setAnnotations(1, [note])
    expect(must(await rig.db.getSetlist(setlist.id)).songs[1].annotations).to.deep.equal([note])
    await rig.page.setAnnotations(1, [])
    expect('annotations' in must(await rig.db.getSetlist(setlist.id)).songs[1]).to.equal(false)
  })
})
