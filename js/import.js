// Import tool for migrating filesystem data to IndexedDB

import { ChordProParser } from './parser.js';
import { SetalightDB, normalizeTitle, hashText, generateSongId, extractLyricsText, determineSetlistType, parseTempo } from './db.js';
import { getGlobalSongsDB } from './songs-db.js';

export class SetlistImporter {
    constructor(workspaceId = null) {
        this.workspaceDb = new SetalightDB(workspaceId);
        this.songsDb = null; // Will be initialized in init()
        this.parser = new ChordProParser();
        this.songsCache = new Map(); // In-memory cache during import
    }

    async init() {
        await this.workspaceDb.init();
        this.songsDb = await getGlobalSongsDB();
    }

    /**
     * Parse directory listing HTML from http.server
     * @param {string} html - HTML directory listing
     * @returns {Array<string>} - Array of file/directory names
     */
    _parseDirectoryListing(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const links = doc.querySelectorAll('a');
        const items = [];

        for (const link of links) {
            const href = link.getAttribute('href');
            // Skip parent directory link and absolute URLs
            if (href && href !== '../' && !href.startsWith('http') && !href.startsWith('/')) {
                items.push(href.replace(/\/$/, '')); // Remove trailing slash
            }
        }

        return items;
    }

    /**
     * Fetch directory listing from server
     * @param {string} path - Path relative to server root (e.g., "sets/")
     * @returns {Array<string>} - Array of directory/file names
     */
    async _fetchDirectoryListing(path) {
        // Use reload cache mode to bypass service worker and get real directory listing
        const response = await fetch(`/${path}`, { cache: 'reload' });
        if (!response.ok) {
            throw new Error(`Failed to fetch directory listing: ${response.status}`);
        }
        const html = await response.text();
        return this._parseDirectoryListing(html);
    }

    /**
     * Import all setlists from server into IndexedDB
     * @param {Function} progressCallback - Optional callback for progress updates
     */
    async importFromServer(progressCallback = null) {
        console.log('[Import] Starting import from server');

        // Clear existing data
        if (progressCallback) progressCallback({ stage: 'clearing', message: 'Clearing existing data...' });
        await this.workspaceDb.clearAll();
        await this.songsDb.clearAll();
        this.songsCache.clear();
        console.log('[Import] Cleared existing data');

        if (progressCallback) progressCallback({ stage: 'fetching', message: 'Fetching setlists from server...' });

        try {
            // Fetch directory listing from /sets/
            const setlistDirs = await this._fetchDirectoryListing('sets');
            console.log(`[Import] Found ${setlistDirs.length} setlist directories:`, setlistDirs);

            const setlists = [];

            for (const dirName of setlistDirs) {
                console.log(`[Import] Checking directory: ${dirName}`);

                // Directory names should be in YYYY-MM-DD format
                const dateMatch = dirName.match(/^\d{4}-\d{2}-\d{2}$/);
                if (!dateMatch) {
                    console.log(`[Import] Skipping ${dirName} - doesn't match date format`);
                    continue;
                }

                // Fetch files in this setlist directory
                const files = await this._fetchDirectoryListing(`sets/${dirName}`);
                console.log(`[Import] Files in ${dirName}:`, files);

                const chordproFiles = files.filter(f =>
                    f.endsWith('.cho') ||
                    f.endsWith('.chordpro') ||
                    f.endsWith('.txt') ||
                    f.includes('chordpro')
                );
                console.log(`[Import] ChordPro files in ${dirName}:`, chordproFiles);

                setlists.push({
                    id: dirName,
                    date: dirName,
                    path: `sets/${dirName}/`,
                    songs: chordproFiles.map(f => ({
                        filename: f,
                        path: `sets/${dirName}/${f}`
                    }))
                });
            }

            // Sort by date, most recent first
            setlists.sort((a, b) => b.date.localeCompare(a.date));
            console.log(`[Import] Processing ${setlists.length} setlists (after cutoff filter):`, setlists.map(s => ({ id: s.id, songCount: s.songs.length })));

            // Import each setlist
            const importedSetlists = [];
            for (let i = 0; i < setlists.length; i++) {
                const setlistData = setlists[i];
                console.log(`[Import] ========== Importing setlist ${i + 1}/${setlists.length}: ${setlistData.id} with ${setlistData.songs.length} songs ==========`);
                if (progressCallback) {
                    progressCallback({
                        stage: 'importing',
                        message: `Importing ${setlistData.id}...`,
                        current: i + 1,
                        total: setlists.length
                    });
                }

                try {
                    const setlist = await this.importSetlistFromServer(setlistData);
                    importedSetlists.push(setlist);
                    console.log(`[Import] ✅ Successfully imported setlist: ${setlistData.id} with ${setlist.songs.length} songs`);
                } catch (err) {
                    console.error(`[Import] ❌ Failed to import ${setlistData.id}:`, err);
                }
            }

            // Save all songs to both global and workspace databases
            // Global DB: For future workspace switching
            // Workspace DB: For backward compatibility with existing app
            if (progressCallback) progressCallback({ stage: 'saving', message: 'Saving songs to database...' });
            for (const song of this.songsCache.values()) {
                // Save to global songs database
                await this.songsDb.saveSong(song);

                // LEGACY: Also save to workspace DB for backward compatibility
                // Convert to legacy format with appearances for old app code
                const legacySong = {
                    ...song,
                    chordproText: song.rawChordPro, // Old field name
                    appearances: [], // Will be populated by song_usage later
                    createdAt: song.importedAt,
                    lastUsedAt: song.importedAt
                };
                await this.workspaceDb.saveSong(legacySong);
            }

            console.log(`[Import] Complete! Imported ${importedSetlists.length} setlists, ${this.songsCache.size} unique songs`);

            if (progressCallback) {
                progressCallback({
                    stage: 'complete',
                    message: `Import complete! ${importedSetlists.length} setlists, ${this.songsCache.size} songs`,
                    setlists: importedSetlists.length,
                    songs: this.songsCache.size
                });
            }

            return {
                success: true,
                setlists: importedSetlists.length,
                songs: this.songsCache.size
            };
        } catch (error) {
            console.error('[Import] Import failed:', error);
            if (progressCallback) {
                progressCallback({
                    stage: 'error',
                    message: `Import failed: ${error.message}`
                });
            }
            throw error;
        }
    }

    /**
     * Import a single setlist from server data
     */
    async importSetlistFromServer(setlistData) {
        const songs = [];

        console.log(`[Import] Importing setlist: ${setlistData.id} with ${setlistData.songs.length} songs`);

        // Process each song
        for (let order = 0; order < setlistData.songs.length; order++) {
            const songData = setlistData.songs[order];
            console.log(`[Import] Processing song: ${songData.filename}`);

            try {
                // Fetch the ChordPro file content
                const response = await fetch(`/${songData.path}`);
                if (!response.ok) {
                    throw new Error(`Failed to fetch ${songData.path}: ${response.status}`);
                }
                const chordproText = await response.text();
                console.log(`[Import] Read ${chordproText.length} chars from ${songData.filename}`);

                // Parse the chordpro
                const parsed = this.parser.parse(chordproText);
                console.log(`[Import] Parsed song: ${parsed.metadata.title}`);

                // Check if song has at least one section (not just a title)
                const hasSections = parsed.sections && parsed.sections.length > 0;

                if (!hasSections) {
                    console.log(`[Import] Skipping song without sections: ${parsed.metadata.title}`);
                    // Keep in setlist but don't add to song database
                    // Use a placeholder songId and store text inline
                    songs.push({
                        order: order,
                        songId: `placeholder-${hashText(songData.filename)}`,
                        chordproEdits: chordproText, // Store inline since not in DB
                        modifications: {
                            targetKey: null,
                            bpmOverride: null,
                            fontSize: 1.6,
                            sectionStates: {}
                        }
                    });
                } else {
                    // Find or create song in collection
                    const songId = await this.findOrCreateSong(parsed, chordproText, setlistData.id, setlistData.date);
                    console.log(`[Import] Song ID: ${songId}`);

                    // Add to setlist
                    songs.push({
                        order: order,
                        songId: songId,
                        chordproEdits: null,
                        modifications: {
                            targetKey: null,
                            bpmOverride: null,
                            fontSize: 1.6,
                            sectionStates: {}
                        }
                    });
                }
            } catch (err) {
                console.error(`[Import] Failed to import song ${songData.filename}:`, err);
            }
        }

        console.log(`[Import] Found ${songs.length} songs in ${setlistData.id}`);

        // Sort songs by order
        songs.sort((a, b) => a.order - b.order);

        // Extract name from setlist ID
        const name = this.extractSetlistName(setlistData.id);

        // Create setlist object with new fields
        const setlist = {
            id: setlistData.id,
            date: setlistData.date,
            time: '10:30', // Default time
            type: determineSetlistType(setlistData.date, name),
            name: name || '',
            leader: '', // Will be populated with user details later
            songs: songs,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Save setlist to workspace database
        await this.workspaceDb.saveSetlist(setlist);

        // Update song usage tracking
        await this.workspaceDb.updateSongUsageOnSetlistSave(setlist);

        return setlist;
    }

    /**
     * Find existing song or create new one in global database
     * Returns songId
     */
    async findOrCreateSong(parsed, chordproText, setlistId, setlistDate) {
        const songId = generateSongId(parsed);
        const textHash = hashText(chordproText);

        // Check if we've already seen this song during this import
        if (this.songsCache.has(songId)) {
            // Song already in cache, just return its ID
            return songId;
        }

        // Parse tempo to extract BPM and note subdivision
        const tempoParsed = parseTempo(parsed.metadata.tempo);

        // Create new song entry (only static content, no usage data)
        const song = {
            id: songId,
            ccliNumber: parsed.metadata.ccliSongNumber || parsed.metadata.ccli || null,
            title: parsed.metadata.title || 'Untitled',
            titleNormalized: normalizeTitle(parsed.metadata.title || 'untitled'),
            artist: parsed.metadata.artist || null,
            rawChordPro: chordproText,
            metadata: {
                key: parsed.metadata.key || null,
                tempo: tempoParsed.bpm,
                tempoNote: tempoParsed.note,
                timeSignature: parsed.metadata.time || null
            },
            lyricsText: extractLyricsText(parsed),
            textHash: textHash,
            sourceWorkspace: this.workspaceDb.workspaceId || 'default',
            importedAt: new Date().toISOString()
        };

        // Add to cache
        this.songsCache.set(songId, song);

        return songId;
    }

    /**
     * Extract optional name from directory name
     * e.g. "2025-10-12-morning-service" -> "Morning Service"
     */
    extractSetlistName(dirName) {
        const parts = dirName.split('-');
        if (parts.length > 3) {
            // Has event name
            return parts.slice(3)
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }
        return null;
    }
}
