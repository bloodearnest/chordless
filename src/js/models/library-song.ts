import type { LoadedSong, ParsedChart, SectionState } from '../data-types.ts'
import type { ChordlessDB } from '../db.ts'
import {
  clearSongUserPrefs,
  getSongUserPrefs,
  type SongUserPrefs,
  saveSongUserPrefs,
} from '../song-user-prefs.ts'
import { normalizeCapo } from '../utils/capo.ts'
import { SongModel } from './song-model.ts'

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
/** Changes made but not yet saved */
interface PendingChanges {
  key: string | null
  tempo: number | null
  capo: number | null
  sectionStates: Record<number, SectionState>
}

export class LibrarySong extends SongModel {
  _song: LoadedSong
  _db: ChordlessDB
  _orgId: string
  _pendingChanges: PendingChanges

  /**
   * @param song - Full song object with parsed content
   * @param db - Database instance
   * @param orgId - Organisation ID
   */
  constructor(song: LoadedSong, db: ChordlessDB, orgId: string) {
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

  override get id(): string {
    return this._song.id
  }

  override get uuid(): string {
    return this._song.uuid
  }

  override get title(): string {
    return this._song.title || 'Untitled'
  }

  override get artist(): string | null {
    return this._song.author || this._song.artist || null
  }

  override get parsed(): ParsedChart {
    return this._song.parsed
  }

  // ==================== Mutable Properties ====================

  override getKey(): string | null | undefined {
    // Return pending change if it exists, otherwise current key
    if (this._pendingChanges.key !== null) {
      return this._pendingChanges.key
    }
    return this._song.key
  }

  override setKey(key: string): void {
    this._pendingChanges.key = key
  }

  override getOriginalKey(): string | null | undefined {
    return this._song.originalKey || this._song.key
  }

  override getTempo(): number | null | undefined {
    // Return pending change if it exists, otherwise current tempo
    if (this._pendingChanges.tempo !== null) {
      return this._pendingChanges.tempo
    }
    return this._song.tempo
  }

  override setTempo(tempo: number): void {
    this._pendingChanges.tempo = tempo
  }

  override getOriginalTempo(): number | null | undefined {
    return this._song.originalTempo || this._song.tempo
  }

  override getCapo(): number {
    // Return pending change if it exists
    if (this._pendingChanges.capo !== null) {
      return this._pendingChanges.capo
    }

    // Load from song-user-prefs
    const prefs = getSongUserPrefs(this._song.id, this._orgId)
    if (prefs && prefs.capo !== undefined) {
      return normalizeCapo(prefs.capo)
    }

    return 0
  }

  override setCapo(capo: number | string): void {
    this._pendingChanges.capo = normalizeCapo(capo)
  }

  override getSectionState(sectionIndex: number): SectionState {
    // Return pending change if it exists
    if (this._pendingChanges.sectionStates[sectionIndex]) {
      return this._pendingChanges.sectionStates[sectionIndex]
    }

    // Load from song-user-prefs
    const prefs = getSongUserPrefs(this._song.id, this._orgId)
    if (prefs?.sectionDefaults?.[sectionIndex.toString()]) {
      return prefs.sectionDefaults[sectionIndex.toString()]
    }

    // Return app defaults
    return {
      hideMode: 'none',
      isCollapsed: false,
      isHidden: false,
    }
  }

  override setSectionState(sectionIndex: number, state: Partial<SectionState>): void {
    this._pendingChanges.sectionStates[sectionIndex] = {
      ...this.getSectionState(sectionIndex),
      ...state,
    }
  }

  // ==================== Persistence ====================

  override async save(): Promise<void> {
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
    const prefsToSave: SongUserPrefs = {}

    if (this._pendingChanges.capo !== null) {
      prefsToSave.capo = this._pendingChanges.capo
    }

    if (Object.keys(this._pendingChanges.sectionStates).length > 0) {
      // Merge with existing section defaults
      const existingPrefs = getSongUserPrefs(this._song.id, this._orgId)
      const existingSections = existingPrefs?.sectionDefaults || {}

      const sectionDefaults: Record<string, SectionState> = { ...existingSections }

      for (const [index, state] of Object.entries(this._pendingChanges.sectionStates)) {
        sectionDefaults[index.toString()] = state
      }
      prefsToSave.sectionDefaults = sectionDefaults
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

  override async reset(): Promise<void> {
    // Reset key and tempo to original values
    this._pendingChanges.key = this.getOriginalKey() ?? null
    this._pendingChanges.tempo = this.getOriginalTempo() ?? null

    // Clear capo and section states from song-user-prefs
    clearSongUserPrefs(this._song.id, this._orgId)
    this._pendingChanges.capo = 0
    this._pendingChanges.sectionStates = {}

    // Save the reset state
    await this.save()
  }
}
