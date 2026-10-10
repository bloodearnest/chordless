// biome-ignore-all lint/correctness/noUnusedFunctionParameters: abstract methods keep their documented signatures
import type { LoadedSong, ParsedChart, SectionState } from '../data-types.ts'

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
   */
  get id(): string {
    throw new Error('SongModel.id must be implemented by subclass')
  }

  /**
   * Get the song UUID (unique per variant)
   */
  get uuid(): string {
    throw new Error('SongModel.uuid must be implemented by subclass')
  }

  /**
   * Get the song title
   */
  get title(): string {
    throw new Error('SongModel.title must be implemented by subclass')
  }

  /**
   * Get the song artist/author
   */
  get artist(): string | null {
    throw new Error('SongModel.artist must be implemented by subclass')
  }

  /**
   * Get the parsed ChordPro data
   */
  get parsed(): ParsedChart {
    throw new Error('SongModel.parsed must be implemented by subclass')
  }

  // ==================== Mutable Properties ====================

  /**
   * Get the current key
   */
  getKey(): string | null | undefined {
    throw new Error('SongModel.getKey() must be implemented by subclass')
  }

  /**
   * Set the current key
   * @param key - Musical key (e.g., "G", "Am")
   */
  setKey(key: string): void {
    throw new Error('SongModel.setKey() must be implemented by subclass')
  }

  /**
   * Get the original imported key (for reset)
   */
  getOriginalKey(): string | null | undefined {
    throw new Error('SongModel.getOriginalKey() must be implemented by subclass')
  }

  /**
   * Get the current tempo (BPM)
   */
  getTempo(): number | null | undefined {
    throw new Error('SongModel.getTempo() must be implemented by subclass')
  }

  /**
   * Set the current tempo
   * @param tempo - Tempo in BPM
   */
  setTempo(tempo: number): void {
    throw new Error('SongModel.setTempo() must be implemented by subclass')
  }

  /**
   * Get the original imported tempo (for reset)
   */
  getOriginalTempo(): number | null | undefined {
    throw new Error('SongModel.getOriginalTempo() must be implemented by subclass')
  }

  /**
   * Get the current capo value
   */
  getCapo(): number {
    throw new Error('SongModel.getCapo() must be implemented by subclass')
  }

  /**
   * Set the current capo value
   * @param capo - Capo fret (0-11)
   */
  setCapo(capo: number | string): void {
    throw new Error('SongModel.setCapo() must be implemented by subclass')
  }

  /**
   * Get the state for a specific section
   * @param sectionIndex - Zero-based section index
   */
  getSectionState(sectionIndex: number): SectionState {
    throw new Error('SongModel.getSectionState() must be implemented by subclass')
  }

  /**
   * Set the state for a specific section
   * @param sectionIndex - Zero-based section index
   */
  setSectionState(sectionIndex: number, state: Partial<SectionState>): void {
    throw new Error('SongModel.setSectionState() must be implemented by subclass')
  }

  /**
   * Get the current font size
   */
  getFontSize(): number {
    // Font size is not persisted yet
    // Could be added to song-user-prefs or setlist state if needed
    return 16 // Default
  }

  /**
   * Set the current font size
   * @param size - Font size in pixels
   */
  setFontSize(size: number): void {
    // Not implemented yet
    // Could save to song-user-prefs or setlist localStorage if needed
  }

  // ==================== Persistence ====================

  /**
   * Save all changes to persistent storage
   */
  async save(): Promise<void> {
    throw new Error('SongModel.save() must be implemented by subclass')
  }

  /**
   * Reset song to default/original state
   */
  async reset(): Promise<void> {
    throw new Error('SongModel.reset() must be implemented by subclass')
  }

  // ==================== Metadata ====================

  /**
   * Get the underlying song object for metadata access
   * @returns The canonical song data
   */
  protected _getUnderlyingSong(): LoadedSong {
    throw new Error('SongModel._getUnderlyingSong() must be implemented by subclass')
  }

  /**
   * Get additional metadata
   */
  getMetadata(): { ccliNumber?: string | null; timeSignature?: string | null } {
    const song = this._getUnderlyingSong()
    return {
      ccliNumber: song.ccliNumber || song.parsed?.metadata?.ccliSongNumber,
      timeSignature: song.time || song.parsed?.metadata?.time,
    }
  }

  // ==================== Helpers ====================

  /**
   * Normalize capo value to valid range (0-11)
   * @param capo - Capo value to normalize
   * @returns Normalized capo value
   */
  protected _normalizeCapo(capo: number | string): number {
    const val = Number.parseInt(String(capo), 10)
    if (Number.isNaN(val)) return 0
    return Math.min(Math.max(val, 0), 11)
  }
}
