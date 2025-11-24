/**
 * Base class for song data abstraction
 *
 * Provides a common interface for accessing and persisting song data,
 * with different implementations for library songs and setlist songs.
 */
export class SongModel {
  // ==================== Core Properties ====================

  /**
   * Get the deterministic song ID (e.g., "ccli-12345" or "title-...")
   * @returns {string}
   */
  get id() {
    throw new Error('SongModel.id must be implemented by subclass')
  }

  /**
   * Get the song UUID (unique per variant)
   * @returns {string}
   */
  get uuid() {
    throw new Error('SongModel.uuid must be implemented by subclass')
  }

  /**
   * Get the song title
   * @returns {string}
   */
  get title() {
    throw new Error('SongModel.title must be implemented by subclass')
  }

  /**
   * Get the song artist/author
   * @returns {string|null}
   */
  get artist() {
    throw new Error('SongModel.artist must be implemented by subclass')
  }

  /**
   * Get the parsed ChordPro data
   * @returns {Object}
   */
  get parsed() {
    throw new Error('SongModel.parsed must be implemented by subclass')
  }

  // ==================== Mutable Properties ====================

  /**
   * Get the current key
   * @returns {string|null}
   */
  getKey() {
    throw new Error('SongModel.getKey() must be implemented by subclass')
  }

  /**
   * Set the current key
   * @param {string} key - Musical key (e.g., "G", "Am")
   */
  setKey(key) {
    throw new Error('SongModel.setKey() must be implemented by subclass')
  }

  /**
   * Get the original imported key (for reset)
   * @returns {string|null}
   */
  getOriginalKey() {
    throw new Error('SongModel.getOriginalKey() must be implemented by subclass')
  }

  /**
   * Get the current tempo (BPM)
   * @returns {number|null}
   */
  getTempo() {
    throw new Error('SongModel.getTempo() must be implemented by subclass')
  }

  /**
   * Set the current tempo
   * @param {number} tempo - Tempo in BPM
   */
  setTempo(tempo) {
    throw new Error('SongModel.setTempo() must be implemented by subclass')
  }

  /**
   * Get the original imported tempo (for reset)
   * @returns {number|null}
   */
  getOriginalTempo() {
    throw new Error('SongModel.getOriginalTempo() must be implemented by subclass')
  }

  /**
   * Get the current capo value
   * @returns {number}
   */
  getCapo() {
    throw new Error('SongModel.getCapo() must be implemented by subclass')
  }

  /**
   * Set the current capo value
   * @param {number} capo - Capo fret (0-11)
   */
  setCapo(capo) {
    throw new Error('SongModel.setCapo() must be implemented by subclass')
  }

  /**
   * Get the state for a specific section
   * @param {number} sectionIndex - Zero-based section index
   * @returns {{hideMode: string, isCollapsed: boolean, isHidden: boolean}}
   */
  getSectionState(sectionIndex) {
    throw new Error('SongModel.getSectionState() must be implemented by subclass')
  }

  /**
   * Set the state for a specific section
   * @param {number} sectionIndex - Zero-based section index
   * @param {{hideMode?: string, isCollapsed?: boolean, isHidden?: boolean}} state
   */
  setSectionState(sectionIndex, state) {
    throw new Error('SongModel.setSectionState() must be implemented by subclass')
  }

  /**
   * Get the current font size
   * @returns {number}
   */
  getFontSize() {
    // Font size is not persisted yet
    // Could be added to song-user-prefs or setlist state if needed
    return 16 // Default
  }

  /**
   * Set the current font size
   * @param {number} size - Font size in pixels
   */
  setFontSize(size) {
    // Not implemented yet
    // Could save to song-user-prefs or setlist localStorage if needed
  }

  // ==================== Persistence ====================

  /**
   * Save all changes to persistent storage
   * @returns {Promise<void>}
   */
  async save() {
    throw new Error('SongModel.save() must be implemented by subclass')
  }

  /**
   * Reset song to default/original state
   * @returns {Promise<void>}
   */
  async reset() {
    throw new Error('SongModel.reset() must be implemented by subclass')
  }

  // ==================== Metadata ====================

  /**
   * Get the underlying song object for metadata access
   * @protected
   * @returns {Object} The canonical song data
   */
  _getUnderlyingSong() {
    throw new Error('SongModel._getUnderlyingSong() must be implemented by subclass')
  }

  /**
   * Get additional metadata
   * @returns {{ccliNumber?: string, timeSignature?: string}}
   */
  getMetadata() {
    const song = this._getUnderlyingSong()
    return {
      ccliNumber: song.ccliNumber || song.parsed?.metadata?.ccliSongNumber,
      timeSignature: song.time || song.parsed?.metadata?.time,
    }
  }

  // ==================== Helpers ====================

  /**
   * Normalize capo value to valid range (0-11)
   * @protected
   * @param {number|string} capo - Capo value to normalize
   * @returns {number} Normalized capo value
   */
  _normalizeCapo(capo) {
    const val = Number.parseInt(capo, 10)
    if (Number.isNaN(val)) return 0
    return Math.min(Math.max(val, 0), 11)
  }
}
