import type { ParsedChart } from '../data-types.ts'

/**
 * Base class for song data abstraction
 *
 * Provides a common interface for accessing and persisting song data,
 * with different implementations for library songs and setlist songs.
 */
export abstract class SongModel {
  // ==================== Core Properties ====================

  /**
   * Get the deterministic song ID (e.g., "ccli-12345" or "title-...")
   */
  abstract get id(): string

  /**
   * Get the song UUID (unique per variant)
   */
  abstract get uuid(): string

  /**
   * Get the song title
   */
  abstract get title(): string

  /**
   * Get the song artist/author
   */
  abstract get artist(): string | null

  /**
   * Get the parsed ChordPro data
   */
  abstract get parsed(): ParsedChart

  // ==================== Mutable Properties ====================

  /**
   * Get the current key
   */
  abstract getKey(): string | null | undefined

  /**
   * Set the current key
   * @param key - Musical key (e.g., "G", "Am")
   */
  abstract setKey(key: string): void

  /**
   * Get the original imported key (for reset)
   */
  abstract getOriginalKey(): string | null | undefined

  /**
   * Get the current tempo (BPM)
   */
  abstract getTempo(): number | null | undefined

  /**
   * Set the current tempo
   * @param tempo - Tempo in BPM
   */
  abstract setTempo(tempo: number): void

  /**
   * Get the original imported tempo (for reset)
   */
  abstract getOriginalTempo(): number | null | undefined

  /**
   * Get the current capo value
   */
  abstract getCapo(): number

  /**
   * Set the current capo value
   * @param capo - Capo fret (0-11)
   */
  abstract setCapo(capo: number | string): void

  // ==================== Persistence ====================

  /**
   * Save all changes to persistent storage
   */
  abstract save(): Promise<void>

  /**
   * Reset song to default/original state
   */
  abstract reset(): Promise<void>
}
