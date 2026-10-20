/**
 * Song Utilities
 *
 * Helper functions for working with the new song data model.
 * Songs are now stored per-space with a flattened variant model.
 * Each variant is a separate song document linked by variantOf field.
 */

import type {
  ChartMetadata,
  ParsedChart,
  SongInput,
  SongRecord,
  SongWithContent,
} from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { getCurrentDB, normalizeTitle } from './db.ts'
import { ChordProParser } from './parser.ts'
import { hashText } from './utils/hash.ts'

export { hashText }

const parser = new ChordProParser()
const parseCache = new Map<string, ParsedChart>()
const MAX_CACHE_SIZE = 100

/**
 * Get full song with parsed metadata from chordpro
 *
 * @param songUuid - Song UUID (specific variant)
 * @param db - Optional database instance (uses getCurrentDB if not provided)
 * @returns Song with parsed content and metadata
 */
export async function getSongWithContent(
  songUuid: string,
  db: ChordlessDB | null = null
): Promise<SongWithContent> {
  const database = db ?? (await getCurrentDB())

  const song = await database.getSong(songUuid)
  if (!song) {
    throw new Error(`Song not found: ${songUuid}`)
  }

  // Get chordpro content
  const chordpro = await database.getChordPro(song.chordproFileId)
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

    // The record's own key and tempo (what the library saved), and the ones it was imported with
    key: song.key,
    originalKey: song.originalKey,
    tempo: song.tempo,
    originalTempo: song.originalTempo,

    // Metadata object (for UI components)
    metadata: {
      key: parsed.metadata.key || song.key,
      tempo: parsed.metadata.tempo || song.tempo,
      timeSignature: parsed.metadata.time || song.time,
      // The chart's copyright and CCLI lines, for the song info dialog
      copyright: parsed.metadata.copyright || song.copyright || undefined,
      ccli: parsed.metadata.ccli,
      ccliSongNumber: parsed.metadata.ccliSongNumber,
      ccliTrailer: parsed.metadata.ccliTrailer,
    },

    // ChordPro content
    chordpro: chordpro.content,
    chordproFileId: song.chordproFileId,

    // Parsed structure
    parsed: parsed,
  }
}

/**
 * The library's songs, by title: one entry for each song (its default variant, not
 * every variant), with its chart parsed. A song that can't be loaded is left out.
 * @param db the space's database
 * @param options.withLastUsage also set lastUsageInfo on each song, from the setlist it was
 *   last played in: {date, leader, key}
 */
export async function getLibrarySongs(
  db: ChordlessDB,
  { withLastUsage = false }: { withLastUsage?: boolean } = {}
): Promise<SongWithContent[]> {
  const records = await db.getAllSongs()

  // One song per deterministic id, not one per variant
  const byId = new Map<string, SongRecord>()
  for (const record of records) {
    if (record.isDefault || !byId.has(record.id)) byId.set(record.id, record)
  }

  const songs: SongWithContent[] = []
  for (const record of byId.values()) {
    try {
      const song = await getSongWithContent(record.uuid, db)
      if (withLastUsage) {
        const usage = await db.getSongUsageFromSetlists(song.id)
        if (usage?.length > 0) {
          song.lastUsageInfo = {
            date: usage[0].setlistDate,
            leader: usage[0].leader,
            key: usage[0].playedInKey,
          }
        }
      }
      songs.push(song)
    } catch (error) {
      console.error(`Error loading song ${record.uuid}:`, error)
    }
  }

  return songs.sort((a, b) =>
    (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase())
  )
}

/**
 * Get all variants of a song
 *
 * @param songId - Deterministic song ID
 * @param db - Optional database instance
 * @returns Array of song variants
 */
export async function getSongVariants(
  songId: string,
  db: ChordlessDB | null = null
): Promise<SongRecord[]> {
  const database = db ?? (await getCurrentDB())
  return await database.getSongVariants(songId)
}

/**
 * Get default variant for a song
 *
 * @param songId - Deterministic song ID
 * @param db - Optional database instance
 * @returns Default variant or null
 */
export async function getDefaultVariant(
  songId: string,
  db: ChordlessDB | null = null
): Promise<SongRecord | null> {
  const database = db ?? (await getCurrentDB())
  return await database.getDefaultSongVariant(songId)
}

/**
 * Get song with content by deterministic ID (gets default variant)
 *
 * @param songId - Deterministic song ID
 * @param db - Optional database instance
 * @returns Song with parsed content and metadata
 */
export async function getSongById(
  songId: string,
  db: ChordlessDB | null = null
): Promise<SongWithContent> {
  const database = db ?? (await getCurrentDB())

  // Get default variant for this song
  const song = await database.getDefaultSongVariant(songId)
  if (!song) {
    throw new Error(`Song not found: ${songId}`)
  }

  // Return full song with content
  return await getSongWithContent(song.uuid, database)
}

/**
 * Find existing song by CCLI number or title
 *
 * @param ccliNumber - CCLI number
 * @param title - Song title
 * @param db - Optional database instance
 * @returns Existing song or null
 */
export async function findExistingSong(
  ccliNumber: string | null | undefined,
  title: string | null | undefined,
  db: ChordlessDB | null = null
): Promise<SongRecord | null> {
  const database = db ?? (await getCurrentDB())

  // Try CCLI first
  if (ccliNumber) {
    const songs = await database.findSongByCCLI(ccliNumber)
    if (songs.length > 0) {
      // Return default variant if available
      const defaultSong = songs.find(s => s.isDefault)
      return defaultSong || songs[0]
    }
  }

  // Try normalized title
  if (title) {
    const titleNormalized = normalizeTitle(title)
    const songs = await database.findSongByNormalizedTitle(titleNormalized)
    if (songs.length > 0) {
      const defaultSong = songs.find(s => s.isDefault)
      return defaultSong || songs[0]
    }
  }

  return null
}

/** Store a chart's text as a new chordpro file; its id */
async function saveNewChordPro(db: ChordlessDB, content: string, contentHash: string) {
  const id = `chordpro-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  await db.saveChordPro({ id, content, contentHash, createdDate: now, modifiedDate: now })
  return id
}

/** Who a chart is: the CCLI number and title that identify its song, and the song's id */
export interface ChartIdentity {
  ccliNumber: string | null
  title: string
  titleNormalized: string
  id: string
}

/**
 * The identity of a chart's song. The chart's own CCLI number and title win; `fallback` is what
 * to use for those it lacks, and `fallback.id` an id the song already has. The id is the CCLI
 * number's, else the title's, else (no title at all) a new one: untitled songs are not one song.
 */
export function chartIdentity(
  metadata: ChartMetadata,
  fallback: { ccliNumber?: string | null; title?: string | null; id?: string | null } = {}
): ChartIdentity {
  const ccliNumber = metadata.ccliSongNumber || metadata.ccli || fallback.ccliNumber || null
  const named = metadata.title || fallback.title
  const title = named || 'Untitled'
  const titleNormalized = normalizeTitle(title)
  const derivedId = ccliNumber
    ? `ccli-${ccliNumber}`
    : named
      ? `title-${titleNormalized}`
      : `song-${crypto.randomUUID()}`
  return { ccliNumber, title, titleNormalized, id: fallback.id || derivedId }
}

/** Where a new song stands among the variants of its song */
interface Placement {
  variantOf: string | null
  isDefault: boolean
  variantLabel: string
}

/** Where a new song came from */
interface Provenance {
  importUser: string | null
  importSource: string
  sourceUrl: string | null
}

/** Store a chart as a new song (and its chordpro file) */
async function insertSong(
  db: ChordlessDB,
  chordpro: string,
  metadata: ChartMetadata,
  identity: ChartIdentity,
  placement: Placement,
  provenance: Provenance
): Promise<SongRecord> {
  const contentHash = hashText(chordpro)
  const chordproFileId = await saveNewChordPro(db, chordpro, contentHash)
  const now = new Date().toISOString()
  return db.saveSong({
    uuid: crypto.randomUUID(),
    id: identity.id,
    ...placement,
    chordproFileId,
    ccliNumber: identity.ccliNumber,
    title: identity.title,
    titleNormalized: identity.titleNormalized,
    ...chartFields(metadata),
    importDate: now,
    ...provenance,
    modifiedDate: now,
    fileRef: null,
    fileModified: null,
    lastSyncedAt: null,
    contentHash,
  })
}

/** What createSong (and createVariant) can be told beyond the chart itself */
export interface CreateSongOptions {
  ccliNumber?: string | null
  title?: string
  /** Make a new variant even if the song exists */
  forceNew?: boolean
  variantOf?: string | null
  variantLabel?: string
  importUser?: string
  importSource?: string
  sourceUrl?: string | null
}

/**
 * Create a new song from a chart in the current space's database. Throws if the song
 * is already there, unless forceNew makes this a variant of it.
 */
export async function createSong(
  chordproContent: string,
  options: CreateSongOptions = {}
): Promise<SongRecord> {
  const db = await getCurrentDB()
  const { metadata } = parser.parse(chordproContent)
  const identity = chartIdentity(metadata, options)

  const existing = await findExistingSong(identity.ccliNumber, identity.title, db)
  if (existing && !options.forceNew) {
    throw new Error(
      `Song already exists: ${existing.title} (${existing.id}). Use forceNew option to create variant.`
    )
  }

  return insertSong(
    db,
    chordproContent,
    metadata,
    identity,
    {
      variantOf: options.variantOf || null,
      isDefault: !existing, // Only first variant is default
      variantLabel: options.variantLabel || 'Original',
    },
    {
      importUser: options.importUser || 'default-user',
      importSource: options.importSource || 'manual',
      sourceUrl: options.sourceUrl || null,
    }
  )
}

/** How addChart treats a chart of a song the database already has in another form */
export interface AddChartOptions {
  variantLabel: string
  importSource: string
  /** The new chart becomes the song's default ('newest'), or only if it is the first ('first') */
  makeDefault: 'newest' | 'first'
  /** The title to use if the chart has none */
  title?: string
}

/**
 * Put a chart into a database as a song, unless it already has this exact chart (then that
 * song is returned). A chart of a song the database has in another form is added as a variant
 * of it. Never deletes anything.
 */
export async function addChart(
  db: ChordlessDB,
  chordpro: string,
  { variantLabel, importSource, makeDefault, title }: AddChartOptions
): Promise<SongRecord> {
  const contentHash = hashText(chordpro)
  const known = await db.getAllSongs()
  const same = known.find(existing => existing.contentHash === contentHash)
  if (same) return same

  const { metadata } = parser.parse(chordpro)
  const identity = chartIdentity(metadata, { title })
  const sameSong = known.filter(existing => existing.id === identity.id)
  const currentDefault = sameSong.find(existing => existing.isDefault)
  const isDefault = makeDefault === 'newest' || !currentDefault
  if (isDefault && currentDefault) await db.saveSong({ ...currentDefault, isDefault: false })

  return insertSong(
    db,
    chordpro,
    metadata,
    identity,
    {
      variantOf: sameSong.length > 0 && !isDefault ? (currentDefault?.uuid ?? null) : null,
      isDefault,
      variantLabel,
    },
    { importUser: null, importSource, sourceUrl: null }
  )
}

/** The song fields that come from its chart's metadata */
export function chartFields(
  metadata: ChartMetadata
): Pick<
  SongInput,
  'author' | 'copyright' | 'key' | 'originalKey' | 'tempo' | 'originalTempo' | 'time'
> {
  return {
    author: metadata.artist || metadata.author || null,
    copyright: metadata.copyright || null,
    key: metadata.key || null,
    originalKey: metadata.key || null, // Preserve imported key for reset
    tempo: metadata.tempo || null,
    originalTempo: metadata.tempo || null, // Preserve imported tempo for reset
    time: metadata.time || null,
  }
}

/**
 * Replace a song's chart with new content, e.g. a fresh import of the same
 * song. The song keeps its identity (uuid, id, title, variant and Drive
 * fields); the fields that come from the chart are updated. Sync sees the
 * changed chart and uploads it.
 *
 * @param songUuid - UUID of the song to overwrite
 * @param chordproContent - The new ChordPro content
 * @param db - Optional database instance (uses getCurrentDB if not provided)
 * @returns The updated song
 */
export async function overwriteSong(
  songUuid: string,
  chordproContent: string,
  db: ChordlessDB | null = null
): Promise<SongRecord> {
  const database = db ?? (await getCurrentDB())

  const song = await database.getSong(songUuid)
  if (!song) {
    throw new Error(`Song not found: ${songUuid}`)
  }
  const chordpro = await database.getChordPro(song.chordproFileId)
  const now = new Date().toISOString()
  const contentHash = hashText(chordproContent)

  await database.saveChordPro({
    ...chordpro,
    id: song.chordproFileId,
    content: chordproContent,
    contentHash,
    modifiedDate: now,
  })
  parseCache.delete(song.chordproFileId)

  const updated: SongInput = {
    ...song,
    ...chartFields(parser.parse(chordproContent).metadata),
    contentHash,
    modifiedDate: now,
  }
  return database.saveSong(updated)
}

/**
 * Create a variant of an existing song
 *
 * @param sourceUuid - UUID of song to copy from
 * @param variantLabel - Label for the new variant
 * @param chordproContent - ChordPro content for the variant
 * @param options - Additional options
 * @returns Created variant
 */
export async function createVariant(
  sourceUuid: string,
  variantLabel: string,
  chordproContent: string,
  options: CreateSongOptions = {}
): Promise<SongRecord> {
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
 * @param songUuid - UUID of variant to make default
 */
export async function setDefaultVariant(songUuid: string): Promise<void> {
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
function getCachedParsed(fileId: string, content: string): ParsedChart {
  const cached = parseCache.get(fileId)
  if (cached) {
    return cached
  }

  const parsed = parser.parse(content)

  // Limit cache size
  if (parseCache.size >= MAX_CACHE_SIZE) {
    const firstKey = parseCache.keys().next().value
    if (firstKey !== undefined) parseCache.delete(firstKey)
  }

  parseCache.set(fileId, parsed)
  return parsed
}

/**
 * Format artist names from a delimited string
 * Cleans up common prefixes like "Words by", "Music by", etc.
 *
 * @param artistString - Artist string (may contain multiple artists)
 * @returns Array of cleaned artist names
 */
export function formatArtistNames(artistString: string | null | undefined): string[] {
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
