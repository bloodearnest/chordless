// Import Handler for Setalight
// Listens for postMessage from the bookmarklet

import { SetalightDB, generateSongId, normalizeTitle, hashText, extractLyricsText } from './db.js';
import { ChordProParser } from './parser.js';

(async function() {
    'use strict';

    // Initialize database
    const db = new SetalightDB();
    await db.init();

    const parser = new ChordProParser();

    // Listen for messages from the bookmarklet
    window.addEventListener('message', (event) => {
        // Verify origin (only accept from songselect)
        if (!event.origin.startsWith('https://songselect.ccli.com')) {
            return;
        }

        // Check if it's a Setalight import message
        if (event.data && event.data.type === 'SETALIGHT_IMPORT') {
            console.log('[Import] Received import message from:', event.origin);
            processImport(event.data.data);
        }
    });

    // Signal to opener that we're ready to receive data
    function signalReady() {
        if (window.location.hash.includes('import') && window.opener) {
            console.log('[Import] Page loaded, signaling ready to opener...');
            try {
                window.opener.postMessage({
                    type: 'SETALIGHT_READY'
                }, 'https://songselect.ccli.com');
            } catch (e) {
                console.log('[Import] Could not signal opener:', e);
            }
        }
    }

    // Process the imported song
    async function processImport(importData) {
        const { chordproText, metadata, source } = importData;

        console.log('[Import] Processing import from', source);
        console.log('[Import] Song:', metadata.title);
        console.log('[Import] ChordPro length:', chordproText.length);

        try {
            // Parse the ChordPro text
            const parsed = parser.parse(chordproText);

            // Merge bookmarklet metadata with parsed metadata
            parsed.metadata = {
                ...parsed.metadata,
                title: metadata.title || parsed.metadata.title,
                ccliSongNumber: metadata.ccliNumber || parsed.metadata.ccliSongNumber,
                key: metadata.key || parsed.metadata.key
            };

            // Generate song object for IndexedDB
            const song = {
                id: generateSongId(parsed),
                ccliNumber: parsed.metadata.ccliSongNumber,
                title: parsed.metadata.title,
                titleNormalized: normalizeTitle(parsed.metadata.title || ''),
                textHash: hashText(chordproText),
                metadata: parsed.metadata,
                sections: parsed.sections,
                chordproText: chordproText,
                lyricsText: extractLyricsText(parsed),
                importedAt: new Date().toISOString(),
                source: source
            };

            // Save to IndexedDB
            await db.saveSong(song);

            console.log('[Import] Saved song to IndexedDB:', song.id);

            // Show success message
            const message = `✅ Imported: ${song.title}\n\nCCLI: ${song.ccliNumber}\nSaved to song library!`;
            alert(message);

            // Clear the hash
            window.location.hash = '';

        } catch (error) {
            console.error('[Import] Failed to save song:', error);
            alert(`❌ Failed to import song: ${error.message}`);
        }
    }

    // Download the ChordPro as a file
    function downloadAsFile(chordproText, metadata) {
        const blob = new Blob([chordproText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${metadata.ccliNumber}-${metadata.title}.chordpro`.replace(/[^a-z0-9.-]/gi, '_');
        a.click();
        URL.revokeObjectURL(url);
    }

    // Run on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', signalReady);
    } else {
        signalReady();
    }

    // Listen for hash changes (when bookmarklet reuses existing tab)
    window.addEventListener('hashchange', () => {
        if (window.location.hash.includes('import')) {
            console.log('[Import] Hash changed to #import, signaling ready...');
            signalReady();
        }
    });

    // Also expose for manual use
    window.SetalightImport = {
        signalReady: signalReady
    };

})();
