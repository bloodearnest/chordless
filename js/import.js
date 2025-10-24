// Import tool for migrating filesystem data to IndexedDB

import { ChordProParser } from './parser.js';
import { SetalightDB, normalizeTitle, hashText, generateSongId, extractLyricsText } from './db.js';

export class SetlistImporter {
    constructor() {
        this.db = new SetalightDB();
        this.parser = new ChordProParser();
        this.songsCache = new Map(); // In-memory cache during import
    }

    async init() {
        await this.db.init();
    }

    /**
     * Import all setlists from server into IndexedDB
     * @param {string} cutoffDate - ISO date string (e.g. "2025-01-01")
     * @param {Function} progressCallback - Optional callback for progress updates
     */
    async importFromServer(cutoffDate = '2025-01-01', progressCallback = null) {
        console.log('[Import] Starting import from server with cutoff date:', cutoffDate);

        // Clear existing data
        if (progressCallback) progressCallback({ stage: 'clearing', message: 'Clearing existing data...' });
        await this.db.clearAll();
        this.songsCache.clear();
        console.log('[Import] Cleared existing data');

        if (progressCallback) progressCallback({ stage: 'fetching', message: 'Fetching setlists from server...' });

        try {
            // Fetch all setlists from the API
            const response = await fetch(`/api/import?cutoff=${encodeURIComponent(cutoffDate)}`);
            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }

            const setlists = await response.json();
            console.log(`[Import] Received ${setlists.length} setlists from server`);

            // Import each setlist
            const importedSetlists = [];
            for (let i = 0; i < setlists.length; i++) {
                const setlistData = setlists[i];
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
                    console.log(`[Import] Imported setlist: ${setlistData.id}`);
                } catch (err) {
                    console.error(`[Import] Failed to import ${setlistData.id}:`, err);
                }
            }

            // Save all songs to database
            if (progressCallback) progressCallback({ stage: 'saving', message: 'Saving songs to database...' });
            for (const song of this.songsCache.values()) {
                await this.db.saveSong(song);
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
                const chordproText = songData.content;
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

        // Create setlist object
        const setlist = {
            id: setlistData.id,
            date: setlistData.date,
            name: this.extractSetlistName(setlistData.id),
            songs: songs,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Save setlist to database
        await this.db.saveSetlist(setlist);

        return setlist;
    }

    /**
     * Find existing song or create new one
     */
    async findOrCreateSong(parsed, chordproText, setlistId, setlistDate) {
        const songId = generateSongId(parsed);
        const textHash = hashText(chordproText);

        // Check if we've already seen this song during this import
        if (this.songsCache.has(songId)) {
            const song = this.songsCache.get(songId);

            // Add to appearances
            song.appearances.push({
                setlistId: setlistId,
                date: setlistDate,
                playedInKey: parsed.metadata.key || null
            });

            return songId;
        }

        // Create new song entry
        const song = {
            id: songId,
            ccliNumber: parsed.metadata.ccliSongNumber || parsed.metadata.ccli || null,
            title: parsed.metadata.title || 'Untitled',
            titleNormalized: normalizeTitle(parsed.metadata.title || 'untitled'),
            artist: parsed.metadata.artist || null,
            chordproText: chordproText,
            metadata: {
                key: parsed.metadata.key || null,
                tempo: parsed.metadata.tempo || null,
                timeSignature: parsed.metadata.time || null
            },
            lyricsText: extractLyricsText(parsed),
            textHash: textHash,
            appearances: [{
                setlistId: setlistId,
                date: setlistDate,
                playedInKey: parsed.metadata.key || null
            }],
            createdAt: new Date().toISOString(),
            lastUsedAt: setlistDate
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
