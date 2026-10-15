import type { LoadedSong, ParsedChart, SetlistEntry } from '../data-types.ts'
import type { ChordlessDB } from '../db.ts'
import { loadSetlistLocalState, saveSetlistLocalState } from '../setlist/local-state.ts'
import { getSongUserPrefs } from '../song-user-prefs.ts'
import { normalizeCapo } from '../utils/capo.ts'
import { SongModel } from './song-model.ts'

/** Changes made but not yet saved */
interface PendingChanges {
  key: string | null
  tempo: number | null
  capo: number | null
}

/**
 * SetlistSong - Song model for setlist view
 *
 * Storage:
 * - Key/Tempo: Explicit snapshots in setlist entry (IndexedDB, synced)
 * - Capo: Setlist localStorage → song-user-prefs (conditional) → 0 (see setlist/local-state.ts,
 *   which also keeps the section states: those are the setlist page's own)
 *
 * Conditional capo inheritance:
 * - Only applies song-user-prefs capo if setlist entry key === canonical song key
 */
export class SetlistSong extends SongModel {
  _songEntry: SetlistEntry
  _canonical: LoadedSong
  _setlistId: string
  _db: ChordlessDB
  _orgId: string
  _songIndex: number
  _pendingChanges: PendingChanges

  /**
   * @param songEntry - Setlist song entry (from setlist.songs[])
   * @param canonicalSong - Canonical song data with parsed content
   * @param setlistId - Setlist ID
   * @param db - Database instance
   * @param orgId - Organisation ID
   * @param songIndex - Index of this song in the setlist
   */
  constructor(
    songEntry: SetlistEntry,
    canonicalSong: LoadedSong,
    setlistId: string,
    db: ChordlessDB,
    orgId: string,
    songIndex = 0
  ) {
    super()
    this._songEntry = songEntry
    this._canonical = canonicalSong
    this._setlistId = setlistId
    this._db = db
    this._orgId = orgId
    this._songIndex = songIndex

    // In-memory state for changes before save
    this._pendingChanges = {
      key: null,
      tempo: null,
      capo: null,
    }
  }

  // ==================== Core Properties ====================

  override get id(): string {
    return this._songEntry.songId
  }

  override get uuid(): string {
    return this._canonical.uuid
  }

  override get title(): string {
    return this._canonical.title || 'Untitled'
  }

  override get artist(): string | null {
    return this._canonical.author || this._canonical.artist || null
  }

  override get parsed(): ParsedChart {
    return this._canonical.parsed
  }

  // ==================== Mutable Properties ====================

  override getKey(): string | null | undefined {
    // Return pending change if it exists, otherwise entry's explicit key
    if (this._pendingChanges.key !== null) {
      return this._pendingChanges.key
    }
    return this._songEntry.key
  }

  override setKey(key: string): void {
    this._pendingChanges.key = key
  }

  override getOriginalKey(): string | null | undefined {
    return this._canonical.originalKey || this._canonical.key
  }

  override getTempo(): number | null | undefined {
    // Return pending change if it exists, otherwise entry's explicit tempo
    if (this._pendingChanges.tempo !== null) {
      return this._pendingChanges.tempo
    }
    return this._songEntry.tempo
  }

  override setTempo(tempo: number): void {
    this._pendingChanges.tempo = tempo
  }

  override getOriginalTempo(): number | null | undefined {
    return this._canonical.originalTempo || this._canonical.tempo
  }

  override getCapo(): number {
    // Return pending change if it exists
    if (this._pendingChanges.capo !== null) {
      return this._pendingChanges.capo
    }

    // Priority 1: Setlist localStorage
    const { capoValues } = loadSetlistLocalState(this._setlistId)
    if (capoValues[this._songIndex] !== undefined) return normalizeCapo(capoValues[this._songIndex])

    // Priority 2: Song-user-prefs (conditional on key match)
    const currentKey = this.getKey()
    const canonicalKey = this._canonical.key

    if (currentKey === canonicalKey) {
      const prefs = getSongUserPrefs(this._songEntry.songId, this._orgId)
      if (prefs && prefs.capo !== undefined) {
        return normalizeCapo(prefs.capo)
      }
    }

    // Default
    return 0
  }

  override setCapo(capo: number | string): void {
    this._pendingChanges.capo = normalizeCapo(capo)
  }

  // ==================== Persistence ====================

  override async save(): Promise<void> {
    // Save key and tempo to setlist entry in IndexedDB
    if (this._pendingChanges.key !== null || this._pendingChanges.tempo !== null) {
      const setlist = await this._db.getSetlist(this._setlistId)
      if (setlist?.songs[this._songIndex]) {
        if (this._pendingChanges.key !== null) {
          setlist.songs[this._songIndex].key = this._pendingChanges.key
          this._songEntry.key = this._pendingChanges.key
        }
        if (this._pendingChanges.tempo !== null) {
          setlist.songs[this._songIndex].tempo = this._pendingChanges.tempo
          this._songEntry.tempo = this._pendingChanges.tempo
        }
        await this._db.saveSetlist(setlist)
      }
    }

    // Save the capo to the setlist's local state
    if (this._pendingChanges.capo !== null) {
      const state = loadSetlistLocalState(this._setlistId)
      state.capoValues[this._songIndex] = this._pendingChanges.capo
      saveSetlistLocalState(this._setlistId, state)
    }

    // Clear pending changes
    this._pendingChanges = {
      key: null,
      tempo: null,
      capo: null,
    }
  }

  override async reset(): Promise<void> {
    // Reset key and tempo to original from canonical song
    this._pendingChanges.key = this.getOriginalKey() ?? null
    this._pendingChanges.tempo = this.getOriginalTempo() ?? null

    // Forget the capo this device kept for the song
    const state = loadSetlistLocalState(this._setlistId)
    delete state.capoValues[this._songIndex]
    saveSetlistLocalState(this._setlistId, state)

    this._pendingChanges.capo = 0

    // Save the reset state
    await this.save()
  }
}
