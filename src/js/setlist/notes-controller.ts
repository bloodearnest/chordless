/**
 * The notes on a setlist's songs (docs/NOTES.md): loads the three places a song's notes are kept,
 * gives each song's display the ones to draw, and, in edit mode, opens the editor when a spot is
 * long-pressed or a note tapped and keeps what comes of it. Which note goes where is notes/store.ts.
 */
import '../../components/note-editor.ts'
import type { NoteEditor } from '../../components/note-editor.ts'
import type { SongDisplay } from '../../components/song-display.ts'
import { NoteRequestEvent } from '../../components/song-section.ts'
import type { ChartNote, Setlist, SharedChartNote } from '../data-types.ts'
import type { ChordlessDB } from '../db.ts'
import { sectionAnchor, snapOffset, textAnchor } from '../notes/anchor.ts'
import { type ChartNotes, notesBySection } from '../notes/shown.ts'
import {
  allNotes,
  changedSources,
  DEFAULT_NOTE_KIND,
  type NoteSources,
  putNote,
  removeNote,
} from '../notes/store.ts'
import { getNotesPreference, NotesPreferenceEvent } from '../preferences.ts'
import { toast } from '../toast.ts'
import { errorMessage } from '../utils/errors.ts'
import { isEditMode } from './edit-mode-ui.ts'
import { loadSetlistNotes, type SongRef, saveSetlistNotes } from './local-state.ts'
import type { RuntimeSong } from './runtime-songs.ts'

/** What the controller asks of the page it is in */
export interface NotesHost {
  readonly root: HTMLElement
  readonly songs: RuntimeSong[]
  readonly currentSetlist: Setlist | undefined
  readonly currentSetlistId: string | null
  _database(): ChordlessDB
  /** Keep these as the notes everyone with the setlist sees on the song at `index` */
  setAnnotations(index: number, notes: SharedChartNote[]): Promise<void>
  /** Whether the user can share a note with the team on this setlist */
  canShare(): Promise<boolean>
}

export class NotesController {
  #host: NotesHost
  /** By song index */
  #sources: NoteSources[] = []
  #editor: NoteEditor | null = null

  constructor(host: NotesHost) {
    this.#host = host
  }

  #refOf(index: number): SongRef {
    const song = this.#host.songs[index]
    return { songId: song?.songId ?? '', songUuid: song?._setlistEntry.songUuid }
  }

  #songRefs(): SongRef[] {
    return this.#host.songs.map((_, index) => this.#refOf(index))
  }

  /** Read every song's notes: those in the setlist, those on this device for it, and those for the song */
  async load(): Promise<void> {
    const { currentSetlist: setlist, currentSetlistId: id } = this.#host
    const db = this.#host._database()
    this.#sources = await Promise.all(
      this.#host.songs.map(async (_, index) => ({
        shared: setlist?.songs[index]?.annotations ?? [],
        setlistPrivate: loadSetlistNotes(id, this.#refOf(index)),
        songPrivate: await db.getSongNotes(this.#refOf(index).songId),
      }))
    )
  }

  /** The notes to draw on a song: all of them when editing, else those the user's preferences choose */
  chartNotes(index: number): ChartNotes | null {
    const song = this.#host.songs[index]
    const sources = this.#sources[index]
    if (!song?.parsed || !sources) return null
    return notesBySection(
      song.parsed.sections,
      sources,
      isEditMode() ? { shared: true, mine: true } : getNotesPreference()
    )
  }

  /** Give every song's display its notes again (after editing starts or ends, or a preference changes) */
  refreshAll(): void {
    this.#host.songs.forEach((_, index) => {
      this.#refresh(index)
    })
  }

  #refresh(index: number) {
    const display = this.#host.root.querySelector<SongDisplay>(`#song-${index} song-display`)
    if (display) display.notes = this.chartNotes(index)
  }

  /** Listen for the editor to be asked for, and for the notes shown to change */
  listen(signal: AbortSignal): void {
    this.#host.root.addEventListener(
      NoteRequestEvent.type,
      event => void this.#edit(event as NoteRequestEvent),
      { signal }
    )
    window.addEventListener(NotesPreferenceEvent.type, () => this.refreshAll(), { signal })
  }

  async #edit(event: NoteRequestEvent) {
    const { songIndex: index } = event
    const song = this.#host.songs[index]
    const sources = this.#sources[index]
    if (!song || !sources) return

    const existing = event.noteId
      ? allNotes(sources).find(({ note }) => note.id === event.noteId)
      : undefined
    const note: ChartNote = existing?.note ?? {
      id: crypto.randomUUID(),
      anchor: this.#anchorFor(event, song),
      body: { kind: 'text', text: '' },
      modified: new Date().toISOString(),
    }
    // (a drawing is not edited as text)
    if (note.body.kind !== 'text') return

    this.#editor ??= this.#host.root.appendChild(document.createElement('note-editor'))
    const result = await this.#editor.edit({
      anchorElement: event.element,
      about: this.#about(event, song),
      text: note.body.text,
      kind: existing?.kind ?? DEFAULT_NOTE_KIND,
      canShare: await this.#host.canShare(),
      isNew: !existing,
    })
    if (!result) return

    if (result.action === 'delete' || !result.text) {
      if (existing) await this.#apply(index, removeNote(sources, note.id), 'Note deleted', sources)
      return
    }
    const next = putNote(
      sources,
      { ...note, body: { kind: 'text', text: result.text } },
      result.kind
    )
    await this.#apply(index, next)
  }

  #anchorFor(event: NoteRequestEvent, song: RuntimeSong): ChartNote['anchor'] {
    const sections = song.parsed.sections
    if (event.place === 'song') return { kind: 'song' }
    if (event.place === 'title') return sectionAnchor(sections, event.sectionIndex)
    const section = sections[event.sectionIndex]
    if (!section) return { kind: 'song' }
    return textAnchor(
      sections,
      event.sectionIndex,
      event.line,
      snapOffset(section, event.line, event.offset)
    )
  }

  /** What the note is on, for the editor's heading: “grace”, Chorus, the song */
  #about(event: NoteRequestEvent, song: RuntimeSong): string {
    const section = song.parsed.sections[event.sectionIndex]
    if (event.place === 'song') return 'the whole song'
    if (event.place === 'title') return section?.label ? `“${section.label}”` : 'this section'
    const text = section?.lines[event.line]?.segments.map(segment => segment.lyrics).join('') ?? ''
    const word = text
      .slice(
        snapOffset(section ?? { type: 'section', label: null, lines: [] }, event.line, event.offset)
      )
      .match(/[^\s-]+/)?.[0]
    return word ? `“${word}”` : 'this line'
  }

  /** Keep what changed (only the places that differ), show it, and for a deletion offer Undo */
  async #apply(index: number, next: NoteSources, deleted?: string, before?: NoteSources) {
    const previous = this.#sources[index] as NoteSources
    const changed = changedSources(previous, next)
    this.#sources[index] = next
    this.#refresh(index)
    try {
      const { songId } = this.#refOf(index)
      if (changed.includes('setlistPrivate')) {
        saveSetlistNotes(
          this.#host.currentSetlistId,
          this.#refOf(index),
          next.setlistPrivate,
          this.#songRefs()
        )
      }
      if (changed.includes('songPrivate')) {
        await this.#host._database().saveSongNotes(songId, next.songPrivate)
        // (the same song again in the setlist has the same notes)
        this.#host.songs.forEach((other, at) => {
          if (at !== index && other.songId === songId && this.#sources[at]) {
            ;(this.#sources[at] as NoteSources).songPrivate = next.songPrivate
            this.#refresh(at)
          }
        })
      }
      if (changed.includes('shared')) await this.#host.setAnnotations(index, next.shared)
    } catch (error) {
      this.#sources[index] = previous
      this.#refresh(index)
      toast("Couldn't save the note. It is as it was.", {
        kind: 'error',
        details: errorMessage(error),
      })
      return
    }
    if (deleted && before) {
      toast(deleted, { action: { label: 'Undo', run: () => void this.#apply(index, before) } })
    }
  }
}
