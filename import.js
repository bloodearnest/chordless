// Import tool for migrating filesystem data to IndexedDB

import { ChordProParser } from './chordpro-parser.js';
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
     * Import all setlists from filesystem into IndexedDB
     * @param {string} cutoffDate - ISO date string (e.g. "2025-01-01")
     * @param {Function} progressCallback - Optional callback for progress updates
     */
    async importFromFilesystem(cutoffDate = '2025-01-01', progressCallback = null) {
        console.log('[Import] Starting import with cutoff date:', cutoffDate);

        // Clear existing data
        if (progressCallback) progressCallback({ stage: 'clearing', message: 'Clearing existing data...' });
        await this.db.clearAll();
        this.songsCache.clear();
        console.log('[Import] Cleared existing data');

        // Check if File System Access API is supported (Chromium-only)
        if (window.showDirectoryPicker) {
            return await this.importFromFilesystemModern(cutoffDate, progressCallback);
        } else {
            // Firefox/Safari fallback using traditional input element
            return await this.importFromFilesystemFallback(cutoffDate, progressCallback);
        }
    }

    /**
     * Modern import using File System Access API (Chromium)
     */
    async importFromFilesystemModern(cutoffDate, progressCallback) {
        // Get directory handle for sets/
        let setsHandle;
        try {
            setsHandle = await window.showDirectoryPicker({
                id: 'setalight-sets',
                mode: 'read',
                startIn: 'documents'
            });
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('[Import] User cancelled directory picker');
                return { cancelled: true };
            }
            throw err;
        }

        if (progressCallback) progressCallback({ stage: 'scanning', message: 'Scanning directories...' });

        // Read all directories
        const directories = [];
        for await (const entry of setsHandle.values()) {
            if (entry.kind === 'directory') {
                const dirName = entry.name;

                // Extract date from directory name (format: YYYY-MM-DD or YYYY-MM-DD-event-name)
                const dateMatch = dirName.match(/^(\d{4}-\d{2}-\d{2})/);
                if (dateMatch) {
                    const date = dateMatch[1];

                    // Filter by cutoff date
                    if (date >= cutoffDate) {
                        directories.push({
                            handle: entry,
                            date: date,
                            name: dirName
                        });
                    }
                }
            }
        }

        console.log(`[Import] Found ${directories.length} directories after cutoff`);

        // Sort by date (oldest first for consistent ordering)
        directories.sort((a, b) => a.date.localeCompare(b.date));

        // Import each directory as a setlist
        const importedSetlists = [];
        for (let i = 0; i < directories.length; i++) {
            const dir = directories[i];
            if (progressCallback) {
                progressCallback({
                    stage: 'importing',
                    message: `Importing ${dir.name}...`,
                    current: i + 1,
                    total: directories.length
                });
            }

            try {
                const setlist = await this.importSetlist(dir);
                importedSetlists.push(setlist);
                console.log(`[Import] Imported setlist: ${dir.name}`);
            } catch (err) {
                console.error(`[Import] Failed to import ${dir.name}:`, err);
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
    }

    /**
     * Fallback import using traditional file input (Firefox/Safari)
     */
    async importFromFilesystemFallback(cutoffDate, progressCallback) {
        // Create file input element
        const input = document.createElement('input');
        input.type = 'file';
        input.webkitdirectory = true;
        input.directory = true;
        input.multiple = true;

        // Wait for user to select directory
        const files = await new Promise((resolve, reject) => {
            input.onchange = () => resolve(Array.from(input.files));
            input.oncancel = () => resolve(null);
            input.click();
        });

        if (!files) {
            console.log('[Import] User cancelled directory picker');
            return { cancelled: true };
        }

        if (progressCallback) progressCallback({ stage: 'scanning', message: 'Scanning directories...' });

        // Group files by directory
        const dirMap = new Map();
        for (const file of files) {
            // Extract directory path (webkitRelativePath format: "sets/2025-01-01/song.txt")
            const pathParts = file.webkitRelativePath.split('/');
            if (pathParts.length >= 2) {
                const dirName = pathParts[pathParts.length - 2]; // Get parent directory name
                const fileName = pathParts[pathParts.length - 1];

                // Only process .txt files
                if (fileName.endsWith('.txt')) {
                    if (!dirMap.has(dirName)) {
                        dirMap.set(dirName, []);
                    }
                    dirMap.get(dirName).push(file);
                }
            }
        }

        console.log(`[Import] Found ${dirMap.size} directories`);

        // Filter and sort directories by date
        const directories = [];
        for (const [dirName, files] of dirMap.entries()) {
            // Extract date from directory name
            const dateMatch = dirName.match(/^(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
                const date = dateMatch[1];
                if (date >= cutoffDate) {
                    directories.push({
                        name: dirName,
                        date: date,
                        files: files
                    });
                }
            }
        }

        console.log(`[Import] Found ${directories.length} directories after cutoff`);

        // Sort by date
        directories.sort((a, b) => a.date.localeCompare(b.date));

        // Import each directory as a setlist
        const importedSetlists = [];
        for (let i = 0; i < directories.length; i++) {
            const dir = directories[i];
            if (progressCallback) {
                progressCallback({
                    stage: 'importing',
                    message: `Importing ${dir.name}...`,
                    current: i + 1,
                    total: directories.length
                });
            }

            try {
                const setlist = await this.importSetlistFallback(dir);
                importedSetlists.push(setlist);
                console.log(`[Import] Imported setlist: ${dir.name}`);
            } catch (err) {
                console.error(`[Import] Failed to import ${dir.name}:`, err);
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
    }

    /**
     * Import a single setlist directory (fallback method)
     */
    async importSetlistFallback(dir) {
        const setlistId = dir.name;
        const songs = [];

        console.log(`[Import] Importing setlist from directory: ${dir.name}`);

        // Process all files
        for (let order = 0; order < dir.files.length; order++) {
            const file = dir.files[order];
            console.log(`[Import] Processing file: ${file.name}`);

            try {
                const chordproText = await file.text();
                console.log(`[Import] Read ${chordproText.length} chars from ${file.name}`);

                // Parse the chordpro
                const parsed = this.parser.parse(chordproText);
                console.log(`[Import] Parsed song: ${parsed.metadata.title}`);

                // Find or create song in collection
                const songId = await this.findOrCreateSong(parsed, chordproText, setlistId, dir.date);
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
            } catch (err) {
                console.error(`[Import] Failed to import song ${file.name}:`, err);
            }
        }

        console.log(`[Import] Found ${songs.length} songs in ${dir.name}`);

        // Sort songs by order
        songs.sort((a, b) => a.order - b.order);

        // Create setlist object
        const setlist = {
            id: setlistId,
            date: dir.date,
            name: this.extractSetlistName(dir.name),
            songs: songs,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Save setlist to database
        await this.db.saveSetlist(setlist);

        return setlist;
    }

    /**
     * Import a single setlist directory
     */
    async importSetlist(dir) {
        const setlistId = dir.name; // Use directory name as ID
        const songs = [];

        console.log(`[Import] Importing setlist from directory: ${dir.name}`);

        // Read all .cho files in the directory
        let order = 0;
        let fileCount = 0;
        for await (const entry of dir.handle.values()) {
            fileCount++;
            console.log(`[Import] Found entry: ${entry.name} (kind: ${entry.kind})`);

            if (entry.kind === 'file' && entry.name.endsWith('.txt')) {
                console.log(`[Import] Processing txt file: ${entry.name}`);
                try {
                    const file = await entry.getFile();
                    const chordproText = await file.text();
                    console.log(`[Import] Read ${chordproText.length} chars from ${entry.name}`);

                    // Parse the chordpro
                    const parsed = this.parser.parse(chordproText);
                    console.log(`[Import] Parsed song: ${parsed.metadata.title}`);

                    // Find or create song in collection
                    const songId = await this.findOrCreateSong(parsed, chordproText, setlistId, dir.date);
                    console.log(`[Import] Song ID: ${songId}`);

                    // Add to setlist
                    songs.push({
                        order: order++,
                        songId: songId,
                        chordproEdits: null,  // No local edits on import
                        modifications: {
                            targetKey: null,
                            bpmOverride: null,
                            fontSize: 1.6,
                            sectionStates: {}
                        }
                    });
                } catch (err) {
                    console.error(`[Import] Failed to import song ${entry.name}:`, err);
                }
            }
        }

        console.log(`[Import] Found ${fileCount} total entries, ${songs.length} songs in ${dir.name}`);

        // Sort songs by order
        songs.sort((a, b) => a.order - b.order);

        // Create setlist object
        const setlist = {
            id: setlistId,
            date: dir.date,
            name: this.extractSetlistName(dir.name),
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
