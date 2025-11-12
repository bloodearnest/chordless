// Import tool for migrating filesystem data to IndexedDB

import { ChordProParser } from './parser.js';
import { SetalightDB, determineSetlistType } from './db.js';
import { createSong, findExistingSong, hashText } from './song-utils.js';
import { getGlobalSongsDB } from './songs-db.js';
import { getGlobalChordProDB } from './chordpro-db.js';
import { getCurrentUserInfo } from './google-auth.js';
import { parseHtml } from './utils/html-parser.js';

export class SetlistImporter {
    constructor(organisationName = null) {
        this.organisationDb = new SetalightDB(organisationName);
        this.songsDb = null; // Will be initialized in init()
        this.chordproDb = null; // Will be initialized in init()
        this.parser = new ChordProParser();
        this.songsCache = new Map(); // In-memory cache during import
    }

    async init() {
        await this.organisationDb.init();
        this.songsDb = await getGlobalSongsDB();
        this.chordproDb = await getGlobalChordProDB();
    }

    /**
     * Parse directory listing HTML from http.server
     * @param {string} html - HTML directory listing
     * @returns {Array<string>} - Array of file/directory names
     */
    _parseDirectoryListing(html) {
        const doc = parseHtml(html);
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

        // Get current user info for leader field
        const userInfo = await getCurrentUserInfo();
        const defaultLeader = userInfo?.name || userInfo?.email || '';

        if (!defaultLeader) {
            throw new Error('Google account required. Connect with Google before importing setlists.');
        }

        console.log(`[Import] Using default leader: ${defaultLeader}`);
        this.defaultLeader = defaultLeader;

        // Clear existing data (without deleting the database)
        // This works even when multiple tabs are open
        if (progressCallback) progressCallback({ stage: 'clearing', message: 'Clearing existing data...' });

        console.log('[Import] Clearing all data from databases...');

        // Clear songs database (without deleting - works with multiple tabs)
        await this.songsDb.clearAll();

        // Clear organisation database
        await this.organisationDb.clearAll();

        // Clear chordpro database
        await this.chordproDb.clearAll();

        // Clear caches
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

            // Songs are saved to global database as they're imported
            // No need to save again here
            if (progressCallback) progressCallback({ stage: 'complete', message: 'Finalizing import...' });

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
            leader: this.defaultLeader || '', // Populate with current user's name
            songs: songs,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Save setlist to workspace database
        await this.organisationDb.saveSetlist(setlist);

        return setlist;
    }

    /**
     * Find existing song or create new one in global database
     * Returns songId
     */
    async findOrCreateSong(parsed, chordproText, setlistId, setlistDate) {
        const ccliNumber = parsed.metadata.ccliSongNumber || parsed.metadata.ccli || null;
        const title = parsed.metadata.title || 'Untitled';

        // Check if we've already seen this song during this import
        // Use content hash as cache key
        const contentHash = hashText(chordproText);
        if (this.songsCache.has(contentHash)) {
            return this.songsCache.get(contentHash);
        }

        // Check if song already exists in database
        const existing = await findExistingSong(ccliNumber, title, chordproText);

        if (existing) {
            console.log(`[Import] Found existing song: ${title} (${existing.matchType})`);
            this.songsCache.set(contentHash, existing.song.id);
            return existing.song.id;
        }

        // Create new song using new model
        const song = await createSong(chordproText, {
            ccliNumber: ccliNumber,
            title: title,
            source: 'filesystem',
            sourceUrl: `sets/${setlistDate}`,
            versionLabel: 'Original'
        });

        console.log(`[Import] Created new song: ${title} (${song.id})`);

        // Add to cache
        this.songsCache.set(contentHash, song.id);

        return song.id;
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
