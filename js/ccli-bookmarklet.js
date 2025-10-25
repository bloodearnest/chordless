// CCLI to Setalight Bookmarklet
// This is the readable version. The minified version goes in the bookmarklet.

(async function() {
    'use strict';

    // Configuration
    const SETALIGHT_URL = 'http://localhost:8000';

    // Check if we're on a SongSelect page
    if (!window.location.href.includes('songselect.ccli.com')) {
        alert('Please navigate to a SongSelect song page first.');
        return;
    }

    // Extract song metadata
    function extractMetadata() {
        const metadata = {
            title: null,
            artist: null,
            ccliNumber: null,
            copyright: null
        };

        // Extract CCLI number from URL
        const urlMatch = window.location.href.match(/\/songs\/(\d+)/);
        if (urlMatch) {
            metadata.ccliNumber = urlMatch[1];
        }

        // Try to extract title from page
        const titleEl = document.querySelector('h1, .song-title');
        if (titleEl) {
            metadata.title = titleEl.textContent.trim();
        }

        return metadata;
    }

    // Download ChordPro file by calling the API directly
    async function downloadChordPro(songNumber) {
        // Get current key and settings from the page
        // Look for the key selector
        let key = 'C'; // Default
        let style = 'Number'; // Default
        let columns = 1; // Default

        // Try to find the current key from the page
        const keySelector = document.querySelector('[id*="Key"], select[name*="key"]');
        if (keySelector && keySelector.value) {
            key = keySelector.value;
        }

        // Try to extract from the page title or header
        const keyMatch = document.body.textContent.match(/Key:\s*([A-G][b#]?)/i);
        if (keyMatch) {
            key = keyMatch[1];
        }

        // Call the API directly
        const apiUrl = `https://songselect.ccli.com/api/GetSongChordPro?songNumber=${songNumber}&key=${key}&style=${style}&columns=${columns}`;

        console.log('Fetching ChordPro from:', apiUrl);

        const response = await fetch(apiUrl, {
            headers: {
                'accept': '*/*',
                'client-locale': 'en-GB'
            },
            credentials: 'include' // Include cookies for authentication
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const chordproText = data.payload;

        if (!chordproText || chordproText.trim().length === 0) {
            throw new Error('Received empty ChordPro file. Do you have access to this song?');
        }

        return chordproText;
    }

    // Send to Setalight
    async function sendToSetalight(chordproText, metadata) {
        try {
            const response = await fetch(`${SETALIGHT_URL}/api/import-song`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    chordproText: chordproText,
                    metadata: metadata,
                    source: 'songselect'
                })
            });

            if (!response.ok) {
                throw new Error(`Import API failed: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            // Fallback: download locally
            const blob = new Blob([chordproText], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${metadata.title || metadata.ccliNumber || 'song'}.chordpro`;
            a.click();
            URL.revokeObjectURL(url);

            throw new Error('Could not connect to Setalight. File downloaded instead.');
        }
    }

    // Main execution
    try {
        const metadata = extractMetadata();

        if (!metadata.ccliNumber) {
            alert('❌ Could not extract song number from URL');
            return;
        }

        alert('🎵 Starting import to Setalight...');

        console.log('Metadata:', metadata);

        const chordproText = await downloadChordPro(metadata.ccliNumber);
        console.log('Downloaded ChordPro:', chordproText.substring(0, 100));

        await sendToSetalight(chordproText, metadata);

        alert('✅ Song imported to Setalight successfully!');

    } catch (error) {
        console.error('Import failed:', error);
        alert('❌ Import failed: ' + error.message);
    }
})();
