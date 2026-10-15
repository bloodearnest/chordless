import { expect } from '@open-wc/testing'
import '../src/components/song-display.ts'
import type { SongSection } from '../src/components/song-section.ts'
import type { SectionState } from '../src/js/data-types.ts'
import type { LibrarySong } from '../src/js/models/library-song.ts'
import { ChordProParser } from '../src/js/parser.ts'
import { initializeSongSections, renderSongView } from '../src/js/song-view-manager.ts'
import { must } from './must.ts'

const { describe, it, afterEach } = window

const chart = '{title: A}\n{key: G}\n\n{comment: Verse}\n[G]One\n\n{comment: Chorus}\n[C]Two'

describe('the song view', () => {
  let container: HTMLElement

  afterEach(() => container?.remove())

  async function show() {
    container = document.createElement('div')
    document.body.append(container)
    const display = await renderSongView(new ChordProParser().parse(chart), container, {
      songIndex: 0,
      capo: 0,
    })
    await display.updateComplete
    return display
  }

  const sectionsOf = (display: HTMLElement) =>
    Array.from(must(display.shadowRoot).querySelectorAll<SongSection>('song-section'))

  const modelWith = (states: Record<number, Partial<SectionState>>) =>
    ({ getSectionState: (index: number) => states[index] ?? {} }) as unknown as LibrarySong

  it('sets each section to the state the model has for it', async () => {
    const display = await show()
    initializeSongSections(
      container,
      modelWith({
        0: { hideMode: 'chords', isCollapsed: true },
        1: { hideMode: 'hide', isHidden: true },
      }),
      { editMode: true }
    )
    const [first, second] = sectionsOf(display)
    expect([first.hideMode, first.isCollapsed, first.isHidden, first.editMode]).to.deep.equal([
      'chords',
      true,
      false,
      true,
    ])
    expect([second.hideMode, second.isHidden]).to.deep.equal(['hide', true])
  })

  it('shows a section the model says nothing of in full, outside edit mode', async () => {
    const display = await show()
    initializeSongSections(container, modelWith({}))
    for (const section of sectionsOf(display)) {
      expect([
        section.hideMode,
        section.isCollapsed,
        section.isHidden,
        section.editMode,
      ]).to.deep.equal(['none', false, false, false])
    }
  })

  it('leaves a song-display that has not rendered alone', async () => {
    container = document.createElement('div')
    container.innerHTML = '<div><song-display></song-display></div>'
    document.body.append(container)
    expect(() => initializeSongSections(container, modelWith({}))).to.not.throw()
  })
})
