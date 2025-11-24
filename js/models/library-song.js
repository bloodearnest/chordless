import { clearSongUserPrefs, getSongUserPrefs, saveSongUserPrefs } from '../song-user-prefs.js'
import { SongModel } from './song-model.js'

/**
 * LibrarySong - Song model for library view
 *
 * Storage:
 * - Key/Tempo: Saved to canonical song in IndexedDB (shared across all users)
 * - Capo: Saved to song-user-prefs in localStorage (per-user, per-song)
 * - Section visibility: Saved to song-user-prefs in localStorage (per-user, per-song)
 *
 * Priority for capo and sections:
 * 1. Song-user-prefs (localStorage)
 * 2. App defaults
 */
export class LibrarySong extends SongModel {
  /**
   * @param {Object} song - Full song object with parsed content
   * @param {Object} db - Database instance
   * @param {string} orgId - Organisation ID
   */
  constructor(song, db, orgId) {
    super()
    this._song = song
    this._db = db
    this._orgId = orgId

    // In-memory state for changes before save
    this._pendingChanges = {
      key: null,
      tempo: null,
      capo: null,
      sectionStates: {},
    }
  }

  // ==================== Core Properties ====================

  get id() {
    return this._song.id
  }

  get uuid() {
    return this._song.uuid
  }

  get title() {
    return this._song.title || 'Untitled'
  }

  get artist() {
    return this._song.author || this._song.artist || null
  }

  get parsed() {
    return this._song.parsed
  }

  // ==================== Mutable Properties ====================

  getKey() {
    // Return pending change if it exists, otherwise current key
    if (this._pendingChanges.key !== null) {
      return this._pendingChanges.key
    }
    return this._song.key
  }

  setKey(key) {
    this._pendingChanges.key = key
  }

  getOriginalKey() {
    return this._song.originalKey || this._song.key
  }

  getTempo() {
    // Return pending change if it exists, otherwise current tempo
    if (this._pendingChanges.tempo !== null) {
      return this._pendingChanges.tempo
    }
    return this._song.tempo
  }

  setTempo(tempo) {
    this._pendingChanges.tempo = tempo
  }

  getOriginalTempo() {
    return this._song.originalTempo || this._song.tempo
  }

  getCapo() {
    // Return pending change if it exists
    if (this._pendingChanges.capo !== null) {
      return this._pendingChanges.capo
    }

    // Load from song-user-prefs
    const prefs = getSongUserPrefs(this._song.id, this._orgId)
    if (prefs && prefs.capo !== undefined) {
      return this._normalizeCapo(prefs.capo)
    }

    return 0
  }

  setCapo(capo) {
    this._pendingChanges.capo = this._normalizeCapo(capo)
  }

  getSectionState(sectionIndex) {
    // Return pending change if it exists
    if (this._pendingChanges.sectionStates[sectionIndex]) {
      return this._pendingChanges.sectionStates[sectionIndex]
    }

    // Load from song-user-prefs
    const prefs = getSongUserPrefs(this._song.id, this._orgId)
    if (prefs && prefs.sectionDefaults && prefs.sectionDefaults[sectionIndex.toString()]) {
      return prefs.sectionDefaults[sectionIndex.toString()]
    }

    // Return app defaults
    return {
      hideMode: 'none',
      isCollapsed: false,
      isHidden: false,
    }
  }

  setSectionState(sectionIndex, state) {
    this._pendingChanges.sectionStates[sectionIndex] = {
      ...this.getSectionState(sectionIndex),
      ...state,
    }
  }

  // ==================== Persistence ====================

  async save() {
    // Save key and tempo to database
    if (this._pendingChanges.key !== null || this._pendingChanges.tempo !== null) {
      const song = await this._db.getSong(this._song.uuid)
      if (song) {
        if (this._pendingChanges.key !== null) {
          song.key = this._pendingChanges.key
          this._song.key = this._pendingChanges.key
        }
        if (this._pendingChanges.tempo !== null) {
          song.tempo = this._pendingChanges.tempo
          this._song.tempo = this._pendingChanges.tempo
        }
        song.modifiedDate = new Date().toISOString()
        await this._db.saveSong(song)
      }
    }

    // Save capo and section states to song-user-prefs
    const prefsToSave = {}

    if (this._pendingChanges.capo !== null) {
      prefsToSave.capo = this._pendingChanges.capo
    }

    if (Object.keys(this._pendingChanges.sectionStates).length > 0) {
      // Merge with existing section defaults
      const existingPrefs = getSongUserPrefs(this._song.id, this._orgId)
      const existingSections = existingPrefs?.sectionDefaults || {}

      prefsToSave.sectionDefaults = {
        ...existingSections,
      }

      for (const [index, state] of Object.entries(this._pendingChanges.sectionStates)) {
        prefsToSave.sectionDefaults[index.toString()] = state
      }
    }

    if (Object.keys(prefsToSave).length > 0) {
      saveSongUserPrefs(this._song.id, this._orgId, prefsToSave)
    }

    // Clear pending changes
    this._pendingChanges = {
      key: null,
      tempo: null,
      capo: null,
      sectionStates: {},
    }
  }

  async reset() {
    // Reset key and tempo to original values
    this._pendingChanges.key = this.getOriginalKey()
    this._pendingChanges.tempo = this.getOriginalTempo()

    // Clear capo and section states from song-user-prefs
    clearSongUserPrefs(this._song.id, this._orgId)
    this._pendingChanges.capo = 0
    this._pendingChanges.sectionStates = {}

    // Save the reset state
    await this.save()
  }

  // ==================== Protected Methods ====================

  _getUnderlyingSong() {
    return this._song
  }
}
