import type { ParsedChart } from '../data-types.ts'

/**
 * Song data, as a library song and a setlist song both give it: reading it, changing it, and
 * persisting it.
 */
export interface SongModel {
  // ==================== Core Properties ====================

  /**
   * Get the deterministic song ID (e.g., "ccli-12345" or "title-...")
   */
  readonly id: string

  /**
   * Get the song UUID (unique per variant)
   */
  readonly uuid: string

  /**
   * Get the song title
   */
  readonly title: string

  /**
   * Get the song artist/author
   */
  readonly artist: string | null

  /**
   * Get the parsed ChordPro data
   */
  readonly parsed: ParsedChart

  // ==================== Mutable Properties ====================

  /**
   * Get the current key
   */
  getKey(): string | null | undefined

  /**
   * Set the current key
   * @param key - Musical key (e.g., "G", "Am")
   */
  setKey(key: string): void

  /**
   * Get the original imported key (for reset)
   */
  getOriginalKey(): string | null | undefined

  /**
   * Get the current tempo (BPM)
   */
  getTempo(): number | null | undefined

  /**
   * Set the current tempo
   * @param tempo - Tempo in BPM
   */
  setTempo(tempo: number): void

  /**
   * Get the original imported tempo (for reset)
   */
  getOriginalTempo(): number | null | undefined

  /**
   * Get the current capo value
   */
  getCapo(): number

  /**
   * Set the current capo value
   * @param capo - Capo fret (0-11)
   */
  setCapo(capo: number | string): void

  // ==================== Persistence ====================

  /**
   * Save all changes to persistent storage
   */
  save(): Promise<void>

  /**
   * Reset song to default/original state
   */
  reset(): Promise<void>
}
