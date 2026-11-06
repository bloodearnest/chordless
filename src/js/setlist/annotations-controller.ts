/**
 * The annotations on a setlist's songs (docs/ANNOTATIONS.md): loads the two places a song's annotations are kept,
 * gives each song's display the ones to draw, and, in edit mode, opens the editor when a spot is
 * long-pressed or an annotation tapped and keeps what comes of it. Which annotation goes where is annotations/store.ts.
 */
import '../../components/annotation-editor.ts'
import type { AnnotationEditor } from '../../components/annotation-editor.ts'
import type { SongDisplay } from '../../components/song-display.ts'
import { AnnotationRequestEvent } from '../../components/song-section.ts'
import { sectionAnchor, snapOffset, textAnchor } from '../annotations/anchor.ts'
import { healSources } from '../annotations/heal.ts'
import { annotationsBySection, type ChartAnnotations } from '../annotations/shown.ts'
import {
  type AnnotationSources,
  allAnnotations,
  changedSources,
  DEFAULT_ANNOTATION_KIND,
  putAnnotation,
  removeAnnotation,
} from '../annotations/store.ts'
import type { ChartAnnotation, Setlist, SharedChartAnnotation } from '../data-types.ts'
import { AnnotationsPreferenceEvent, getAnnotationsPreference } from '../preferences.ts'
import { toast } from '../toast.ts'
import { errorMessage } from '../utils/errors.ts'
import { isEditMode } from './edit-mode-ui.ts'
import { loadSetlistAnnotations, type SongRef, saveSetlistAnnotations } from './local-state.ts'
import type { RuntimeSong } from './runtime-songs.ts'

/** What the controller asks of the page it is in */
export interface AnnotationsHost {
  readonly root: HTMLElement
  readonly songs: RuntimeSong[]
  readonly currentSetlist: Setlist | undefined
  readonly currentSetlistId: string | null
  /** Keep these as the annotations everyone with the setlist sees on the song at `index` */
  setAnnotations(index: number, annotations: SharedChartAnnotation[]): Promise<void>
  /** Whether the user can share an annotation with everyone on this setlist */
  canShare(): Promise<boolean>
}

export class AnnotationsController {
  #host: AnnotationsHost
  /** By song index */
  #sources: AnnotationSources[] = []
  #editor: AnnotationEditor | null = null

  constructor(host: AnnotationsHost) {
    this.#host = host
  }

  #refOf(index: number): SongRef {
    const song = this.#host.songs[index]
    return { songId: song?.songId ?? '', songUuid: song?._setlistEntry.songUuid }
  }

  #songRefs(): SongRef[] {
    return this.#host.songs.map((_, index) => this.#refOf(index))
  }

  /** Read every song's annotations: those in the setlist (everyone's), and those on this device for it (the user's own) */
  async load(): Promise<void> {
    const { currentSetlist: setlist, currentSetlistId: id } = this.#host
    this.#sources = await Promise.all(
      this.#host.songs.map(async (_, index) => ({
        shared: setlist?.songs[index]?.annotations ?? [],
        private: loadSetlistAnnotations(id, this.#refOf(index)),
      }))
    )
    this.#healPrivate()
  }

  /**
   * The chart is fixed in place and the fix arrives by sync, so where an annotation is can differ from
   * where it is kept. The user's own are kept up to date as the setlist is drawn (this device only,
   * so nothing is sent); see annotations/anchor.ts
   */
  #healPrivate() {
    this.#host.songs.forEach((song, index) => {
      const sources = this.#sources[index]
      const healed =
        sources && song.parsed && healSources(song.parsed.sections, sources, ['private'])
      if (!healed) return
      this.#sources[index] = healed
      saveSetlistAnnotations(
        this.#host.currentSetlistId,
        this.#refOf(index),
        healed.private,
        this.#songRefs()
      )
    })
  }

  /**
   * The same for those shared with everyone, which are in the setlist and so are written by someone
   * who can write it, when they finish editing (not by every device that sees a fix: others find
   * their place the same way from what is kept, without writing)
   */
  async healShared(): Promise<void> {
    if (!(await this.#host.canShare())) return
    for (const [index, song] of this.#host.songs.entries()) {
      const sources = this.#sources[index]
      const healed =
        sources && song.parsed && healSources(song.parsed.sections, sources, ['shared'])
      if (!healed) continue
      this.#sources[index] = healed
      try {
        await this.#host.setAnnotations(index, healed.shared)
      } catch (error) {
        console.error('[Annotations] Could not keep where annotations are:', error)
      }
    }
  }

  /** The annotations to draw on a song: all of them when editing, else those the user's preferences choose */
  chartAnnotations(index: number): ChartAnnotations | null {
    const song = this.#host.songs[index]
    const sources = this.#sources[index]
    if (!song?.parsed || !sources) return null
    return annotationsBySection(
      song.parsed.sections,
      sources,
      isEditMode() ? { shared: true, mine: true } : getAnnotationsPreference()
    )
  }

  /** Give every song's display its annotations again (after editing starts or ends, or a preference changes) */
  refreshAll(): void {
    this.#host.songs.forEach((_, index) => {
      this.#refresh(index)
    })
  }

  #refresh(index: number) {
    const display = this.#host.root.querySelector<SongDisplay>(`#song-${index} song-display`)
    if (display) display.annotations = this.chartAnnotations(index)
  }

  /** Listen for the editor to be asked for, and for the annotations shown to change */
  listen(signal: AbortSignal): void {
    this.#host.root.addEventListener(
      AnnotationRequestEvent.type,
      event => void this.#edit(event as AnnotationRequestEvent),
      { signal }
    )
    window.addEventListener(AnnotationsPreferenceEvent.type, () => this.refreshAll(), { signal })
  }

  async #edit(event: AnnotationRequestEvent) {
    const { songIndex: index } = event
    const song = this.#host.songs[index]
    const sources = this.#sources[index]
    if (!song || !sources) return

    const existing = event.annotationId
      ? allAnnotations(sources).find(({ annotation }) => annotation.id === event.annotationId)
      : undefined
    const annotation: ChartAnnotation = existing?.annotation ?? {
      id: crypto.randomUUID(),
      anchor: this.#anchorFor(event, song),
      body: { kind: 'text', text: '' },
      modified: new Date().toISOString(),
    }
    // (a drawing is not edited as text)
    if (annotation.body.kind !== 'text') return

    this.#editor ??= this.#host.root.appendChild(document.createElement('annotation-editor'))
    const result = await this.#editor.edit({
      anchorElement: event.element,
      about: this.#about(event, song),
      text: annotation.body.text,
      kind: existing?.kind ?? DEFAULT_ANNOTATION_KIND,
      canShare: await this.#host.canShare(),
      isNew: !existing,
    })
    if (!result) return

    if (result.action === 'delete' || !result.text) {
      if (existing)
        await this.#apply(
          index,
          removeAnnotation(sources, annotation.id),
          'Annotation deleted',
          sources
        )
      return
    }
    const next = putAnnotation(
      sources,
      { ...annotation, body: { kind: 'text', text: result.text } },
      result.kind
    )
    await this.#apply(index, next)
  }

  #anchorFor(event: AnnotationRequestEvent, song: RuntimeSong): ChartAnnotation['anchor'] {
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

  /** What the annotation is on, for the editor's heading: “grace”, Chorus, the song */
  #about(event: AnnotationRequestEvent, song: RuntimeSong): string {
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
  async #apply(
    index: number,
    next: AnnotationSources,
    deleted?: string,
    before?: AnnotationSources
  ) {
    const previous = this.#sources[index] as AnnotationSources
    const changed = changedSources(previous, next)
    this.#sources[index] = next
    this.#refresh(index)
    try {
      if (changed.includes('private')) {
        saveSetlistAnnotations(
          this.#host.currentSetlistId,
          this.#refOf(index),
          next.private,
          this.#songRefs()
        )
      }
      if (changed.includes('shared')) await this.#host.setAnnotations(index, next.shared)
    } catch (error) {
      this.#sources[index] = previous
      this.#refresh(index)
      toast("Couldn't save the annotation. It is as it was.", {
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
