/**
 * Song Utilities
 *
 * Helper functions for working with the new song data model.
 * Handles loading songs with parsed chordpro content, creating songs,
 * managing versions, and parsing on-demand.
 */

import { getGlobalSongsDB } from './songs-db.js';
import { getGlobalChordProDB } from './chordpro-db.js';
import { ChordProParser } from './parser.js';
import { normalizeTitle, hashText } from './db.js';

const parser = new ChordProParser();
const parseCache = new Map();

/**
 * Get full song with parsed metadata from chordpro
 *
 * @param {string} songId - Song ID
 * @param {string|null} versionId - Optional version ID (defaults to default version)
 * @returns {Promise<Object>} Song with parsed content and metadata
 */
export async function getSongWithContent(songId, versionId = null) {
    const songsDB = await getGlobalSongsDB();
    const chordproDB = await getGlobalChordProDB();

    const song = await songsDB.getSong(songId);
    if (!song) {
        throw new Error(`Song not found: ${songId}`);
    }

    // Find version (default to default version)
    let version;
    if (versionId) {
        version = song.versions.find(v => v.id === versionId);
    } else {
        version = song.versions.find(v => v.isDefault) || song.versions[0];
    }

    if (!version) {
        throw new Error(`No version found for song: ${songId}`);
    }

    // Get chordpro content
    const chordpro = await chordproDB.get(version.chordproFileId);
    if (!chordpro) {
        throw new Error(`ChordPro content not found: ${version.chordproFileId}`);
    }

    // Parse chordpro (with caching)
    const parsed = getCachedParsed(version.chordproFileId, chordpro.content);

    return {
        // Song metadata
        id: song.id,
        ccliNumber: song.ccliNumber,
        titleNormalized: song.titleNormalized,
        appearances: song.appearances,
        createdAt: song.createdAt,
        lastUsedAt: song.lastUsedAt,
        source: song.source,
        sourceUrl: song.sourceUrl,

        // Parsed from chordpro (top level for convenience)
        title: parsed.metadata.title || 'Untitled',
        artist: parsed.metadata.artist || null,

        // Metadata object (for backwards compatibility with UI components)
        metadata: {
            key: parsed.metadata.key || null,
            tempo: parsed.metadata.tempo || null,
            timeSignature: parsed.metadata.time || null
        },

        // Version info
        version: {
            id: version.id,
            label: version.label,
            isDefault: version.isDefault,
            chordproFileId: version.chordproFileId,
            tags: version.tags
        },

        // All versions (for version switcher UI)
        allVersions: song.versions.map(v => ({
            id: v.id,
            label: v.label,
            isDefault: v.isDefault
        })),

        // Content
        chordproContent: chordpro.content,
        parsed: parsed
    };
}

/**
 * Parse chordpro with caching
 *
 * @param {string} chordproFileId - ChordPro file ID
 * @param {string} content - Raw chordpro text
 * @returns {Object} Parsed chordpro structure
 */
function getCachedParsed(chordproFileId, content) {
    const cacheKey = `${chordproFileId}-${content.length}`;

    if (parseCache.has(cacheKey)) {
        return parseCache.get(cacheKey);
    }

    const parsed = parser.parse(content);
    parseCache.set(cacheKey, parsed);

    // Limit cache size
    if (parseCache.size > 100) {
        const firstKey = parseCache.keys().next().value;
        parseCache.delete(firstKey);
    }

    return parsed;
}

/**
 * Create a new song with single version
 *
 * @param {string} chordproContent - Raw chordpro text
 * @param {Object} metadata - Optional metadata overrides
 * @returns {Promise<Object>} Created song
 */
export async function createSong(chordproContent, metadata = {}) {
    const songsDB = await getGlobalSongsDB();
    const chordproDB = await getGlobalChordProDB();

    // Parse to extract metadata
    const parsed = parser.parse(chordproContent);

    // Generate IDs
    const songId = metadata.songId || `song-${crypto.randomUUID()}`;
    const versionId = metadata.versionId || 'version-original';
    const chordproFileId = `chordpro-${crypto.randomUUID()}`;

    const ccliNumber = metadata.ccliNumber || parsed.metadata.ccliSongNumber || null;
    const title = metadata.title || parsed.metadata.title || 'Untitled';
    const contentHash = hashText(chordproContent);

    // Save chordpro content
    await chordproDB.save({
        id: chordproFileId,
        content: chordproContent,
        contentHash: contentHash,
        lastModified: Date.now(),
        driveModifiedTime: null,
        lastSyncedAt: null,
        syncStatus: 'not-synced'
    });

    // Create song
    const song = {
        id: songId,
        ccliNumber: ccliNumber,
        titleNormalized: normalizeTitle(title),
        versions: [
            {
                id: versionId,
                label: metadata.versionLabel || 'Original',
                chordproFileId: chordproFileId,
                isDefault: true,
                createdAt: new Date().toISOString(),
                tags: metadata.tags || ['original', 'import'],
                driveChordproFileId: null,
                driveProperties: {
                    songId: songId,
                    versionId: versionId,
                    contentHash: contentHash,
                    ccliNumber: ccliNumber || '',
                    appVersion: '1.0'
                }
            }
        ],
        appearances: [],
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        source: metadata.source || 'manual',
        sourceUrl: metadata.sourceUrl || null,
        driveMetadataFileId: null,
        driveFolderId: null,
        lastSyncedAt: null,
        syncStatus: 'not-synced'
    };

    await songsDB.saveSong(song);

    return song;
}

/**
 * Add a new version to an existing song
 *
 * @param {string} songId - Song ID
 * @param {string} chordproContent - Raw chordpro text
 * @param {string} label - Version label
 * @param {boolean} setAsDefault - Whether to set as default version
 * @returns {Promise<Object>} Updated song
 */
export async function addSongVersion(songId, chordproContent, label, setAsDefault = false) {
    const songsDB = await getGlobalSongsDB();
    const chordproDB = await getGlobalChordProDB();

    const song = await songsDB.getSong(songId);
    if (!song) {
        throw new Error(`Song not found: ${songId}`);
    }

    const versionId = `version-${crypto.randomUUID()}`;
    const chordproFileId = `chordpro-${crypto.randomUUID()}`;
    const contentHash = hashText(chordproContent);

    // Save chordpro
    await chordproDB.save({
        id: chordproFileId,
        content: chordproContent,
        contentHash: contentHash,
        lastModified: Date.now(),
        driveModifiedTime: null,
        lastSyncedAt: null,
        syncStatus: 'not-synced'
    });

    // If setting as default, unset other defaults
    if (setAsDefault) {
        song.versions.forEach(v => v.isDefault = false);
    }

    // Add new version
    song.versions.push({
        id: versionId,
        label: label,
        chordproFileId: chordproFileId,
        isDefault: setAsDefault,
        createdAt: new Date().toISOString(),
        tags: [],
        driveChordproFileId: null,
        driveProperties: {
            songId: songId,
            versionId: versionId,
            contentHash: contentHash,
            ccliNumber: song.ccliNumber || '',
            appVersion: '1.0'
        }
    });

    await songsDB.saveSong(song);

    return song;
}

/**
 * Find existing song by various criteria
 *
 * @param {string|null} ccliNumber - CCLI number
 * @param {string} title - Song title
 * @param {string} chordproContent - ChordPro content (for hash comparison)
 * @returns {Promise<Object|null>} Existing song or null
 */
export async function findExistingSong(ccliNumber, title, chordproContent) {
    const songsDB = await getGlobalSongsDB();
    const chordproDB = await getGlobalChordProDB();

    // Try CCLI first (most reliable)
    if (ccliNumber) {
        const song = await songsDB.findSongByCCLI(ccliNumber);
        if (song) {
            // Check if this exact chordpro content already exists as a version
            const contentHash = hashText(chordproContent);
            for (const version of song.versions) {
                const chordpro = await chordproDB.get(version.chordproFileId);
                if (chordpro && chordpro.contentHash === contentHash) {
                    return {
                        song,
                        version,
                        matchType: 'exact-version'
                    };
                }
            }
            // Same song (by CCLI), but different content
            return {
                song,
                matchType: 'same-song-different-version'
            };
        }
    }

    // Try normalized title
    const normalized = normalizeTitle(title);
    const song = await songsDB.findSongByNormalizedTitle(normalized);
    if (song) {
        return {
            song,
            matchType: 'same-title'
        };
    }

    // Try content hash across all songs
    const contentHash = hashText(chordproContent);
    const chordproMatch = await chordproDB.findByHash(contentHash);
    if (chordproMatch) {
        // Find which song this belongs to
        const allSongs = await songsDB.getAllSongs();
        for (const s of allSongs) {
            for (const version of s.versions) {
                if (version.chordproFileId === chordproMatch.id) {
                    return {
                        song: s,
                        version,
                        matchType: 'exact-content'
                    };
                }
            }
        }
    }

    return null;
}

/**
 * Format artist string for display
 * Cleans up common prefixes like "Words by", "Music by", etc.
 * Returns array of cleaned artist names
 *
 * @param {string} artistString - Raw artist string (may contain multiple artists separated by comma/semicolon/pipe)
 * @returns {string[]} Array of cleaned artist names
 */
export function formatArtistNames(artistString) {
    if (!artistString) return [];

    // Split by comma, semicolon, or pipe
    const artists = artistString.split(/[,;|]/).map(a => a.trim());

    // Clean up each artist name by removing "Words by", "Music by", "Music:", etc.
    const cleanedArtists = artists.map(artist => {
        return artist
            .replace(/^Words\s+by\s+/i, '')
            .replace(/^Music\s+by\s+/i, '')
            .replace(/^Music:\s*/i, '')
            .trim();
    }).filter(a => a.length > 0); // Remove empty strings

    return cleanedArtists;
}

// Re-export utilities from db.js
export { normalizeTitle, hashText };
