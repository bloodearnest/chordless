import { type AppModal, ModalConfirmEvent } from '../components/app-modal.ts'
import { CapoChangeEvent, type CapoSelector } from '../components/capo-selector.ts'
import { KeyChangeEvent, type KeySelector } from '../components/key-selector.ts'
import type { SongDisplay } from '../components/song-display.ts'
import {
  SectionActionEvent,
  SectionToggleEvent,
  type SongSection,
} from '../components/song-section.ts'
import type { ParsedChart, SectionState } from './data-types.ts'
import type { SongModel } from './models/song-model.ts'

/** An element that keeps the listener this module put on it, to replace it next time */
type WithListener<E extends HTMLElement, K extends string> = E & { [P in K]?: EventListener }

/**
 * Song View Manager
 *
 * Shared, stateless functions for rendering and managing single song views.
 * Used by both the library view and setlist-page.js.
 *
 * Design principles:
 * - All functions are stateless
 * - State is passed in via parameters or models
 * - Returns results or uses callbacks for communication
 * - No dependencies on app-level state
 * - Works for both MPA and future SPA architecture
 */

// Configuration constants
const CONFIG = {
  // Font sizes
  DEFAULT_FONT_SIZE: 1.6, // rem
  MIN_FONT_SIZE: 0.8, // rem
  MAX_FONT_SIZE: 3.0, // rem
  FONT_SIZE_STEP: 0.1, // rem

  // Drag and drop
  POSITION_THRESHOLD: 20, // px - minimum movement to change target position
  DRAG_START_THRESHOLD: 5, // px - movement before starting drag

  // Scrolling
  KEYBOARD_SCROLL_AMOUNT: 200, // px - scroll distance for up/down arrows

  // Intersection Observer
  VISIBILITY_THRESHOLD: 0.5, // 50% - section must be this visible to be considered "current"

  // Import
  DEFAULT_IMPORT_CUTOFF: '2000-01-01', // Default date for importing setlists (imports all)
}

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
  songModel: SongModel,
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
    if (Number.isNaN(sectionIndex)) return

    // Get state from model
    const state = songModel.getSectionState(sectionIndex)

    // Apply state
    section.hideMode = state.hideMode || 'none'
    section.isCollapsed = state.isCollapsed || false
    section.isHidden = state.isHidden || false
    section.editMode = editMode
  })
}

/**
 * Setup key selector with model integration
 *
 * @param keySelector - key-selector element
 * @param songModel - Song model
 * @param callbacks - { onChange: (newKey) => void }
 */
export function setupKeySelector(
  keySelector: WithListener<KeySelector, '_keyChangeHandler'> | null,
  songModel: SongModel,
  callbacks: { onChange?: (newKey: string) => void | Promise<void> } = {}
): void {
  if (!keySelector) return

  // Set current key
  keySelector.value = songModel.getKey() ?? ''
  keySelector.originalKey = songModel.getOriginalKey() ?? ''

  // Remove old listener if exists
  const oldHandler = keySelector._keyChangeHandler
  if (oldHandler) {
    keySelector.removeEventListener(KeyChangeEvent.type, oldHandler)
  }

  // Add new listener
  const handler = async (event: Event) => {
    const newKey = event instanceof KeyChangeEvent ? event.value : undefined
    if (newKey && callbacks.onChange) {
      await callbacks.onChange(newKey)
    }
  }
  keySelector._keyChangeHandler = handler
  keySelector.addEventListener(KeyChangeEvent.type, handler)
}

/**
 * Setup capo selector with model integration
 *
 * @param capoSelector - capo-selector element
 * @param songModel - Song model
 * @param callbacks - { onChange: (newCapo) => void }
 * @param options - { enabled }
 */
export function setupCapoSelector(
  capoSelector: WithListener<CapoSelector, '_capoChangeHandler'> | null,
  songModel: SongModel,
  callbacks: { onChange?: (newCapo: number) => void | Promise<void> } = {},
  options: { enabled?: boolean } = {}
): void {
  if (!capoSelector) return

  const { enabled = true } = options

  if (!enabled) {
    capoSelector.style.display = 'none'
    return
  }

  capoSelector.style.display = ''

  // Set current capo
  const currentCapo = songModel.getCapo()
  const currentKey = songModel.getKey()
  capoSelector.value = currentCapo
  capoSelector.referenceKey = currentKey ?? ''

  // Remove old listener if exists
  const oldHandler = capoSelector._capoChangeHandler
  if (oldHandler) {
    capoSelector.removeEventListener(CapoChangeEvent.type, oldHandler)
  }

  // Add new listener
  const handler = async (event: Event) => {
    const newValue = event instanceof CapoChangeEvent ? event.value : undefined
    if (newValue !== undefined && callbacks.onChange) {
      await callbacks.onChange(newValue)
    }
  }
  capoSelector._capoChangeHandler = handler
  capoSelector.addEventListener(CapoChangeEvent.type, handler)
}

/**
 * Setup section controls (hide/show buttons)
 *
 * @param container - Container with song sections
 * @param onAction - Callback (sectionIndex, action) => void
 */
export function setupSectionControls(
  container: WithListener<HTMLElement, '_sectionActionHandler' | '_sectionToggleHandler'> | null,
  onAction: (sectionIndex: number, action: string) => void
): void {
  if (!container) return

  // Remove old listeners if they exist
  if (container._sectionActionHandler) {
    container.removeEventListener(SectionActionEvent.type, container._sectionActionHandler)
  }
  if (container._sectionToggleHandler) {
    container.removeEventListener(SectionToggleEvent.type, container._sectionToggleHandler)
  }

  // Add section-action listener
  const actionHandler = (event: Event) => {
    if (!(event instanceof SectionActionEvent)) return
    const { sectionIndex, action } = event
    if (typeof sectionIndex === 'number' && action && onAction) {
      onAction(sectionIndex, action)
    }
  }
  container._sectionActionHandler = actionHandler
  container.addEventListener(SectionActionEvent.type, actionHandler)

  // Add section-toggle listener (for collapse/expand)
  const toggleHandler = (event: Event) => {
    if (!(event instanceof SectionToggleEvent)) return
    const { sectionIndex } = event
    if (typeof sectionIndex === 'number' && onAction) {
      onAction(sectionIndex, 'collapse')
    }
  }
  container._sectionToggleHandler = toggleHandler
  container.addEventListener(SectionToggleEvent.type, toggleHandler)
}

/**
 * Setup font size controls
 *
 * @param decreaseBtn - Decrease button
 * @param increaseBtn - Increase button
 * @param callbacks - { onDecrease, onIncrease }
 */
export function setupFontSizeControls(
  decreaseBtn: HTMLElement | null,
  increaseBtn: HTMLElement | null,
  callbacks: { onDecrease?: () => void; onIncrease?: () => void } = {}
): void {
  if (decreaseBtn) {
    decreaseBtn.onclick = () => {
      if (callbacks.onDecrease) callbacks.onDecrease()
    }
  }

  if (increaseBtn) {
    increaseBtn.onclick = () => {
      if (callbacks.onIncrease) callbacks.onIncrease()
    }
  }
}

/**
 * Setup reset button
 *
 * @param resetButton - Reset button element
 * @param confirmModal - Confirmation modal
 * @param onConfirm - Callback when reset is confirmed
 */
export function setupResetButton(
  resetButton: HTMLElement | null,
  confirmModal: WithListener<AppModal, '_resetConfirmHandler'> | null,
  onConfirm?: () => void | Promise<void>
): void {
  if (!resetButton || !confirmModal) return

  resetButton.onclick = () => {
    confirmModal.show()
  }

  // Remove old listener if exists
  if (confirmModal._resetConfirmHandler) {
    confirmModal.removeEventListener(ModalConfirmEvent.type, confirmModal._resetConfirmHandler)
  }

  const handler = async () => {
    if (onConfirm) await onConfirm()
  }
  confirmModal._resetConfirmHandler = handler
  confirmModal.addEventListener(ModalConfirmEvent.type, handler)
}

/**
 * Apply font size to song content
 *
 * @param container - Container with .song-content
 * @param fontSize - Font size in pixels
 */
export function applyFontSize(container: HTMLElement | null, fontSize: number): void {
  if (!container) return

  const songContent = container.querySelector<HTMLElement>('.song-content')
  if (songContent) {
    songContent.style.setProperty('--font-lyrics', `${fontSize}px`)
    songContent.style.setProperty('--font-chords', `${Math.max(fontSize - 2, 12)}px`)
  }
}

/**
 * Update song-display capo value
 *
 * @param container - Container with song-display
 * @param capo - Capo value
 */
export function updateSongDisplayCapo(container: HTMLElement | null, capo: number): void {
  if (!container) return

  const songDisplay = container.querySelector('song-display')
  if (songDisplay) {
    songDisplay.capo = capo
  }
}

/**
 * Get song section component
 *
 * @param container - Container to search in
 * @param sectionIndex - Section index
 * @returns song-section component
 */
export function getSongSectionComponent(
  container: HTMLElement | null,
  sectionIndex: number
): SongSection | null {
  if (!container) return null

  // Query into song-display shadow roots
  const songDisplays = container.querySelectorAll('song-display')
  for (const songDisplay of songDisplays) {
    if (songDisplay.shadowRoot) {
      const section = songDisplay.shadowRoot.querySelector<SongSection>(
        `song-section[section-index="${sectionIndex}"]`
      )
      if (section) return section
    }
  }

  return null
}

/**
 * Update section DOM to reflect model state
 *
 * @param container - Container with song sections
 * @param sectionIndex - Section index
 * @param state - { hideMode, isCollapsed, isHidden }
 */
export function updateSectionDOM(
  container: HTMLElement | null,
  sectionIndex: number,
  state: Partial<SectionState>
): void {
  const component = getSongSectionComponent(container, sectionIndex)
  if (!component) return

  component.hideMode = state.hideMode || 'none'
  component.isCollapsed = state.isCollapsed || false
  component.isHidden = state.isHidden || false
}

/**
 * Default configuration
 */
export { CONFIG }
