/**
 * Song View Manager
 *
 * Shared, stateless functions for rendering and managing single song views.
 * Used by both library-app.js and setlist-app.js.
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
 * @param {Object} parsedSong - Parsed ChordPro song data
 * @param {HTMLElement} container - Container to render into
 * @param {Object} options - { songIndex, capo, showControls }
 * @returns {Promise<HTMLElement>} The song-display element
 */
export async function renderSongView(parsedSong, container, options = {}) {
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
 * @param {HTMLElement} container - Container with song-display elements
 * @param {SongModel} songModel - Song model with section state
 * @param {Object} options - { songIndex, editMode }
 */
export function initializeSongSections(container, songModel, options = {}) {
  const { editMode = false } = options

  // Find all song-section elements in shadow DOMs
  const sections = []

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
 * @param {HTMLElement} keySelector - key-selector element
 * @param {SongModel} songModel - Song model
 * @param {Object} callbacks - { onChange: (newKey) => void }
 */
export function setupKeySelector(keySelector, songModel, callbacks = {}) {
  if (!keySelector) return

  // Set current key
  keySelector.value = songModel.getKey()
  keySelector.originalKey = songModel.getOriginalKey()

  // Remove old listener if exists
  const oldHandler = keySelector._keyChangeHandler
  if (oldHandler) {
    keySelector.removeEventListener('key-change', oldHandler)
  }

  // Add new listener
  const handler = async event => {
    const newKey = event.detail?.value
    if (newKey && callbacks.onChange) {
      await callbacks.onChange(newKey)
    }
  }
  keySelector._keyChangeHandler = handler
  keySelector.addEventListener('key-change', handler)
}

/**
 * Setup capo selector with model integration
 *
 * @param {HTMLElement} capoSelector - capo-selector element
 * @param {SongModel} songModel - Song model
 * @param {Object} callbacks - { onChange: (newCapo) => void }
 * @param {Object} options - { enabled }
 */
export function setupCapoSelector(capoSelector, songModel, callbacks = {}, options = {}) {
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
  capoSelector.key = currentKey

  // Remove old listener if exists
  const oldHandler = capoSelector._capoChangeHandler
  if (oldHandler) {
    capoSelector.removeEventListener('capo-change', oldHandler)
  }

  // Add new listener
  const handler = async event => {
    const newValue = event.detail?.value
    if (newValue !== undefined && callbacks.onChange) {
      await callbacks.onChange(newValue)
    }
  }
  capoSelector._capoChangeHandler = handler
  capoSelector.addEventListener('capo-change', handler)
}

/**
 * Setup section controls (hide/show buttons)
 *
 * @param {HTMLElement} container - Container with song sections
 * @param {Function} onAction - Callback (sectionIndex, action) => void
 */
export function setupSectionControls(container, onAction) {
  if (!container) return

  // Remove old listeners if they exist
  if (container._sectionActionHandler) {
    container.removeEventListener('section-action', container._sectionActionHandler)
  }
  if (container._sectionToggleHandler) {
    container.removeEventListener('section-toggle', container._sectionToggleHandler)
  }

  // Add section-action listener
  const actionHandler = event => {
    const { sectionIndex, action } = event.detail || {}
    if (typeof sectionIndex === 'number' && action && onAction) {
      onAction(sectionIndex, action)
    }
  }
  container._sectionActionHandler = actionHandler
  container.addEventListener('section-action', actionHandler)

  // Add section-toggle listener (for collapse/expand)
  const toggleHandler = event => {
    const { sectionIndex } = event.detail || {}
    if (typeof sectionIndex === 'number' && onAction) {
      onAction(sectionIndex, 'collapse')
    }
  }
  container._sectionToggleHandler = toggleHandler
  container.addEventListener('section-toggle', toggleHandler)
}

/**
 * Setup font size controls
 *
 * @param {HTMLElement} decreaseBtn - Decrease button
 * @param {HTMLElement} increaseBtn - Increase button
 * @param {Object} callbacks - { onDecrease, onIncrease }
 */
export function setupFontSizeControls(decreaseBtn, increaseBtn, callbacks = {}) {
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
 * @param {HTMLElement} resetButton - Reset button element
 * @param {HTMLElement} confirmModal - Confirmation modal
 * @param {Function} onConfirm - Callback when reset is confirmed
 */
export function setupResetButton(resetButton, confirmModal, onConfirm) {
  if (!resetButton || !confirmModal) return

  resetButton.onclick = () => {
    confirmModal.open()
  }

  // Remove old listener if exists
  if (confirmModal._resetConfirmHandler) {
    confirmModal.removeEventListener('confirm', confirmModal._resetConfirmHandler)
  }

  const handler = async () => {
    if (onConfirm) await onConfirm()
  }
  confirmModal._resetConfirmHandler = handler
  confirmModal.addEventListener('confirm', handler)
}

/**
 * Apply font size to song content
 *
 * @param {HTMLElement} container - Container with .song-content
 * @param {number} fontSize - Font size in pixels
 */
export function applyFontSize(container, fontSize) {
  if (!container) return

  const songContent = container.querySelector('.song-content')
  if (songContent) {
    songContent.style.setProperty('--font-lyrics', `${fontSize}px`)
    songContent.style.setProperty('--font-chords', `${Math.max(fontSize - 2, 12)}px`)
  }
}

/**
 * Update song-display capo value
 *
 * @param {HTMLElement} container - Container with song-display
 * @param {number} capo - Capo value
 */
export function updateSongDisplayCapo(container, capo) {
  if (!container) return

  const songDisplay = container.querySelector('song-display')
  if (songDisplay) {
    songDisplay.capo = capo
  }
}

/**
 * Get song section component
 *
 * @param {HTMLElement} container - Container to search in
 * @param {number} sectionIndex - Section index
 * @returns {HTMLElement|null} song-section component
 */
export function getSongSectionComponent(container, sectionIndex) {
  if (!container) return null

  // Query into song-display shadow roots
  const songDisplays = container.querySelectorAll('song-display')
  for (const songDisplay of songDisplays) {
    if (songDisplay.shadowRoot) {
      const section = songDisplay.shadowRoot.querySelector(
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
 * @param {HTMLElement} container - Container with song sections
 * @param {number} sectionIndex - Section index
 * @param {Object} state - { hideMode, isCollapsed, isHidden }
 */
export function updateSectionDOM(container, sectionIndex, state) {
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
