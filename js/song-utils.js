/**
 * Song Utilities
 *
 * Helper functions for working with the new song data model.
 * Songs are now stored per-organisation with a flattened variant model.
 * Each variant is a separate song document linked by variantOf field.
 */

import { getCurrentDB, normalizeTitle } from './db.js'
import { ChordProParser } from './parser.js'

const parser = new ChordProParser()
const parseCache = new Map()
const MAX_CACHE_SIZE = 100

/**
 * Get full song with parsed metadata from chordpro
 *
 * @param {string} songUuid - Song UUID (specific variant)
 * @param {Object} db - Optional database instance (uses getCurrentDB if not provided)
 * @returns {Promise<Object>} Song with parsed content and metadata
 */
export async function getSongWithContent(songUuid, db = null) {
  if (!db) {
    db = await getCurrentDB()
  }

  const song = await db.getSong(songUuid)
  if (!song) {
    throw new Error(`Song not found: ${songUuid}`)
  }

  // Get chordpro content
  const chordpro = await db.getChordPro(song.chordproFileId)
  if (!chordpro) {
    throw new Error(`ChordPro content not found: ${song.chordproFileId}`)
  }

  // Parse chordpro (with caching)
  const parsed = getCachedParsed(song.chordproFileId, chordpro.content)

  return {
    // Song identity
    uuid: song.uuid,
    id: song.id,
    variantOf: song.variantOf,
    isDefault: song.isDefault,
    variantLabel: song.variantLabel,

    // Metadata
    ccliNumber: song.ccliNumber,
    titleNormalized: song.titleNormalized,
    importDate: song.importDate,
    importUser: song.importUser,
    importSource: song.importSource,
    modifiedDate: song.modifiedDate,

    // Parsed from chordpro (top level for convenience)
    title: parsed.metadata.title || 'Untitled',
    artist: parsed.metadata.artist || song.author,
    author: song.author,

    // Metadata object (for UI components)
    metadata: {
      key: parsed.metadata.key || song.key,
      tempo: parsed.metadata.tempo || song.tempo,
      timeSignature: parsed.metadata.time || song.time,
    },

    // ChordPro content
    chordpro: chordpro.content,
    chordproFileId: song.chordproFileId,

    // Parsed structure
    parsed: parsed,
  }
}

/**
 * Get all variants of a song
 *
 * @param {string} songId - Deterministic song ID
 * @param {Object} db - Optional database instance
 * @returns {Promise<Array>} Array of song variants
 */
export async function getSongVariants(songId, db = null) {
  if (!db) {
    db = await getCurrentDB()
  }
  return await db.getSongVariants(songId)
}

/**
 * Get default variant for a song
 *
 * @param {string} songId - Deterministic song ID
 * @param {Object} db - Optional database instance
 * @returns {Promise<Object|null>} Default variant or null
 */
export async function getDefaultVariant(songId, db = null) {
  if (!db) {
    db = await getCurrentDB()
  }
  return await db.getDefaultSongVariant(songId)
}

/**
 * Get song with content by deterministic ID (gets default variant)
 *
 * @param {string} songId - Deterministic song ID
 * @param {Object} db - Optional database instance
 * @returns {Promise<Object>} Song with parsed content and metadata
 */
export async function getSongById(songId, db = null) {
  if (!db) {
    db = await getCurrentDB()
  }

  // Get default variant for this song
  const song = await db.getDefaultSongVariant(songId)
  if (!song) {
    throw new Error(`Song not found: ${songId}`)
  }

  // Return full song with content
  return await getSongWithContent(song.uuid, db)
}

/**
 * Find existing song by CCLI number or title
 *
 * @param {string} ccliNumber - CCLI number
 * @param {string} title - Song title
 * @param {Object} db - Optional database instance
 * @returns {Promise<Object|null>} Existing song or null
 */
export async function findExistingSong(ccliNumber, title, db = null) {
  if (!db) {
    db = await getCurrentDB()
  }

  // Try CCLI first
  if (ccliNumber) {
    const songs = await db.findSongByCCLI(ccliNumber)
    if (songs.length > 0) {
      // Return default variant if available
      const defaultSong = songs.find(s => s.isDefault)
      return defaultSong || songs[0]
    }
  }

  // Try normalized title
  if (title) {
    const titleNormalized = normalizeTitle(title)
    const songs = await db.findSongByNormalizedTitle(titleNormalized)
    if (songs.length > 0) {
      const defaultSong = songs.find(s => s.isDefault)
      return defaultSong || songs[0]
    }
  }

  return null
}

/**
 * Create a new song with chordpro content
 *
 * @param {string} chordproContent - ChordPro text
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Created song
 */
export async function createSong(chordproContent, options = {}) {
  const db = await getCurrentDB()

  // Parse chordpro to extract metadata
  const parsed = parser.parse(chordproContent)
  const metadata = parsed.metadata

  // Generate deterministic ID
  const ccliNumber = metadata.ccliSongNumber || metadata.ccli || options.ccliNumber
  const title = metadata.title || options.title || 'Untitled'
  const titleNormalized = normalizeTitle(title)

  let songId
  if (ccliNumber) {
    songId = `ccli-${ccliNumber}`
  } else {
    songId = `title-${titleNormalized}`
  }

  // Check if song already exists
  const existing = await findExistingSong(ccliNumber, title, db)
  if (existing && !options.forceNew) {
    throw new Error(
      `Song already exists: ${existing.title} (${existing.id}). Use forceNew option to create variant.`
    )
  }

  // Create chordpro file
  const chordproFileId = `chordpro-${crypto.randomUUID()}`
  const contentHash = hashText(chordproContent)

  await db.saveChordPro({
    id: chordproFileId,
    content: chordproContent,
    contentHash: contentHash,
    createdDate: new Date().toISOString(),
    modifiedDate: new Date().toISOString(),
  })

  // Create song
  const song = {
    uuid: crypto.randomUUID(),
    id: songId,
    variantOf: options.variantOf || null,
    isDefault: existing ? false : true, // Only first variant is default
    variantLabel: options.variantLabel || 'Original',

    chordproFileId: chordproFileId,

    ccliNumber: ccliNumber || null,
    title: title,
    titleNormalized: titleNormalized,
    author: metadata.artist || metadata.author || null,
    copyright: metadata.copyright || null,
    key: metadata.key || null,
    originalKey: metadata.key || null, // Preserve imported key for reset
    tempo: metadata.tempo || null,
    originalTempo: metadata.tempo || null, // Preserve imported tempo for reset
    time: metadata.time || null,

    importDate: new Date().toISOString(),
    importUser: options.importUser || 'default-user',
    importSource: options.importSource || 'manual',
    sourceUrl: options.sourceUrl || null,
    modifiedDate: new Date().toISOString(),

    driveFileId: null,
    driveModifiedTime: null,
    lastSyncedAt: null,
    contentHash: contentHash,
  }

  await db.saveSong(song)

  return song
}

/**
 * Create a variant of an existing song
 *
 * @param {string} sourceUuid - UUID of song to copy from
 * @param {string} variantLabel - Label for the new variant
 * @param {string} chordproContent - ChordPro content for the variant
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Created variant
 */
export async function createVariant(sourceUuid, variantLabel, chordproContent, options = {}) {
  const db = await getCurrentDB()

  const sourceSong = await db.getSong(sourceUuid)
  if (!sourceSong) {
    throw new Error(`Source song not found: ${sourceUuid}`)
  }

  return await createSong(chordproContent, {
    ...options,
    variantOf: sourceUuid,
    variantLabel: variantLabel,
    ccliNumber: sourceSong.ccliNumber,
    title: sourceSong.title,
    forceNew: true,
  })
}

/**
 * Set a variant as the default for its song
 *
 * @param {string} songUuid - UUID of variant to make default
 * @returns {Promise<void>}
 */
export async function setDefaultVariant(songUuid) {
  const db = await getCurrentDB()

  const song = await db.getSong(songUuid)
  if (!song) {
    throw new Error(`Song not found: ${songUuid}`)
  }

  // Get all variants for this song
  const variants = await db.getSongVariants(song.id)

  // Unset all defaults
  for (const variant of variants) {
    if (variant.isDefault && variant.uuid !== songUuid) {
      variant.isDefault = false
      variant.modifiedDate = new Date().toISOString()
      await db.saveSong(variant)
    }
  }

  // Set this one as default
  if (!song.isDefault) {
    song.isDefault = true
    song.modifiedDate = new Date().toISOString()
    await db.saveSong(song)
  }
}

/**
 * Parse chordpro with caching
 */
function getCachedParsed(fileId, content) {
  if (parseCache.has(fileId)) {
    return parseCache.get(fileId)
  }

  const parsed = parser.parse(content)

  // Limit cache size
  if (parseCache.size >= MAX_CACHE_SIZE) {
    const firstKey = parseCache.keys().next().value
    parseCache.delete(firstKey)
  }

  parseCache.set(fileId, parsed)
  return parsed
}

/**
 * Hash text content (simple hash for now)
 */
export function hashText(text) {
  // Simple hash - could be upgraded to crypto.subtle.digest later
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `hash-${Math.abs(hash).toString(16)}`
}

/**
 * Format artist names from a delimited string
 * Cleans up common prefixes like "Words by", "Music by", etc.
 *
 * @param {string} artistString - Artist string (may contain multiple artists)
 * @returns {Array<string>} Array of cleaned artist names
 */
export function formatArtistNames(artistString) {
  if (!artistString) return []

  // Split by comma, semicolon, or pipe
  const artists = artistString.split(/[,;|]/).map(a => a.trim())

  // Clean up each artist name by removing "Words by", "Music by", "Music:", etc.
  const cleanedArtists = artists
    .map(artist => {
      return artist
        .replace(/^Words\s+by\s+/i, '')
        .replace(/^Music\s+by\s+/i, '')
        .replace(/^Music:\s*/i, '')
        .trim()
    })
    .filter(a => a.length > 0) // Remove empty strings

  return cleanedArtists
}
