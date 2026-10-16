import type { SongDisplay } from '../components/song-display.ts'
import type { SongSection } from '../components/song-section.ts'
import type { ParsedChart } from './data-types.ts'
import type { LibrarySong } from './models/library-song.ts'

/**
 * Song View Manager
 *
 * Shared, stateless functions for rendering and managing single song views.
 * Used by the library view.
 *
 * Design principles:
 * - All functions are stateless
 * - State is passed in via parameters or models
 * - Returns results or uses callbacks for communication
 * - No dependencies on app-level state
 * - Works for both MPA and future SPA architecture
 */

/**
 * Render a song view into a container
 *
 * @param parsedSong - Parsed ChordPro song data
 * @param container - Container to render into
 * @param options - { songIndex, capo }
 * @returns The song-display element
 */
export async function renderSongView(
  parsedSong: ParsedChart,
  container: HTMLElement,
  options: { songIndex?: number; capo?: number } = {}
): Promise<SongDisplay> {
  const { songIndex = 0, capo = 0 } = options

  container.innerHTML = ''

  const songContent = document.createElement('div')
  songContent.className = 'song-content'

  // Create song-display component
  const songDisplay = document.createElement('song-display')
  songDisplay.parsed = parsedSong
  songDisplay.songIndex = songIndex
  songDisplay.capo = capo

  songContent.appendChild(songDisplay)
  container.appendChild(songContent)

  // Wait for song-display to render
  await customElements.whenDefined('song-display')
  await songDisplay.updateComplete

  // Wait for song-section components
  await customElements.whenDefined('song-section')

  return songDisplay
}

/**
 * Initialize song sections with state from a model
 *
 * @param container - Container with song-display elements
 * @param songModel - Song model with section state
 * @param options - { editMode }
 */
export function initializeSongSections(
  container: HTMLElement,
  songModel: Pick<LibrarySong, 'getSectionState'>,
  options: { editMode?: boolean } = {}
): void {
  const { editMode = false } = options

  // Find all song-section elements in shadow DOMs
  const sections: SongSection[] = []

  const songDisplays = container.querySelectorAll('song-display')
  songDisplays.forEach(songDisplay => {
    if (songDisplay.shadowRoot) {
      sections.push(...songDisplay.shadowRoot.querySelectorAll('song-section'))
    }
  })

  sections.forEach(section => {
    const sectionIndex = Number(section.getAttribute('section-index'))

    // Get state from model
    const state = songModel.getSectionState(sectionIndex)

    // Apply state
    section.hideMode = state.hideMode || 'none'
    section.isCollapsed = state.isCollapsed || false
    section.isHidden = state.isHidden || false
    section.editMode = editMode
  })
}
