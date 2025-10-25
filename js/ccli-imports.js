// CCLI Extension Imports Handler
// Handles checking for and processing songs imported via the Chrome extension

import { SetalightDB, generateSongId, normalizeTitle, hashText, extractLyricsText } from './db.js';
import { ChordProParser } from './parser.js';

export class CCLIImportsHandler {
    constructor() {
        this.db = new SetalightDB();
        this.parser = new ChordProParser();
        this.serverUrl = 'http://localhost:5000';
    }

    async init() {
        await this.db.init();
        this.setupUI();
    }

    setupUI() {
        const checkButton = document.getElementById('check-imports-button');
        if (!checkButton) return;

        checkButton.addEventListener('click', async () => {
            checkButton.disabled = true;
            checkButton.textContent = 'Checking...';

            try {
                await this.checkPendingImports();
            } catch (error) {
                console.error('[CCLI] Check failed:', error);
                alert(`Failed to check for imports: ${error.message}`);
            } finally {
                checkButton.disabled = false;
                checkButton.textContent = 'Check for Pending Imports';
            }
        });
    }

    async checkPendingImports() {
        console.log('[CCLI] Checking for pending imports...');

        try {
            const response = await fetch(`${this.serverUrl}/api/pending-imports`);

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('[CCLI] Received:', data);

            if (!data.success) {
                throw new Error(data.error || 'Unknown error');
            }

            this.renderPendingImports(data.imports);
        } catch (error) {
            console.error('[CCLI] Failed to fetch pending imports:', error);
            throw new Error(`Could not connect to server at ${this.serverUrl}. Make sure the server is running.`);
        }
    }

    renderPendingImports(imports) {
        const listContainer = document.getElementById('pending-imports-list');
        const importsContainer = document.getElementById('imports-container');

        if (!imports || imports.length === 0) {
            listContainer.style.display = 'none';
            alert('No pending imports found.');
            return;
        }

        listContainer.style.display = 'block';
        importsContainer.innerHTML = '';

        imports.forEach((importItem, index) => {
            const card = this.createImportCard(importItem, index);
            importsContainer.appendChild(card);
        });
    }

    createImportCard(importItem, index) {
        const { metadata, chordproText, source, importedAt } = importItem;

        const card = document.createElement('div');
        card.className = 'import-card';
        card.style.cssText = `
            background: white;
            border: 2px solid #ecf0f1;
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 1rem;
        `;

        const title = document.createElement('div');
        title.style.cssText = `
            font-size: 1.5rem;
            font-weight: 600;
            color: var(--text-color);
            margin-bottom: 0.5rem;
        `;
        title.textContent = metadata?.title || 'Untitled';

        const meta = document.createElement('div');
        meta.style.cssText = `
            font-size: 1.1rem;
            color: #7f8c8d;
            margin-bottom: 1rem;
        `;
        const metaParts = [];
        if (metadata?.artist) metaParts.push(metadata.artist);
        if (metadata?.ccliNumber) metaParts.push(`CCLI #${metadata.ccliNumber}`);
        if (source) metaParts.push(`Source: ${source}`);
        meta.textContent = metaParts.join(' • ');

        const preview = document.createElement('pre');
        preview.style.cssText = `
            background: #f8f9fa;
            padding: 1rem;
            border-radius: 6px;
            font-size: 0.9rem;
            color: #34495e;
            overflow-x: auto;
            max-height: 200px;
            overflow-y: auto;
            margin-bottom: 1rem;
            font-family: 'Courier New', monospace;
        `;
        preview.textContent = chordproText.substring(0, 500) + (chordproText.length > 500 ? '...' : '');

        const actions = document.createElement('div');
        actions.style.cssText = `
            display: flex;
            gap: 1rem;
        `;

        const addButton = document.createElement('button');
        addButton.className = 'setlist-button';
        addButton.style.cssText = `
            display: inline-block;
            width: auto;
            background-color: #27ae60;
            border-color: #27ae60;
        `;
        addButton.textContent = 'Add to Library';
        addButton.addEventListener('click', async () => {
            addButton.disabled = true;
            addButton.textContent = 'Adding...';

            try {
                await this.addToLibrary(importItem);
                addButton.textContent = '✅ Added!';
                addButton.style.backgroundColor = '#95a5a6';

                setTimeout(() => {
                    card.style.opacity = '0.5';
                    addButton.disabled = true;
                }, 1000);
            } catch (error) {
                console.error('[CCLI] Add failed:', error);
                alert(`Failed to add song: ${error.message}`);
                addButton.disabled = false;
                addButton.textContent = 'Add to Library';
            }
        });

        const skipButton = document.createElement('button');
        skipButton.className = 'setlist-button';
        skipButton.style.cssText = `
            display: inline-block;
            width: auto;
            background-color: #95a5a6;
            border-color: #95a5a6;
        `;
        skipButton.textContent = 'Skip';
        skipButton.addEventListener('click', () => {
            card.style.transition = 'opacity 0.3s';
            card.style.opacity = '0';
            setTimeout(() => card.remove(), 300);
        });

        actions.appendChild(addButton);
        actions.appendChild(skipButton);

        card.appendChild(title);
        card.appendChild(meta);
        card.appendChild(preview);
        card.appendChild(actions);

        return card;
    }

    async addToLibrary(importItem) {
        console.log('[CCLI] Adding to library:', importItem.metadata?.title);

        const { chordproText, metadata } = importItem;

        // Parse the ChordPro
        const parsed = this.parser.parse(chordproText);
        console.log('[CCLI] Parsed:', parsed);

        // Check if song has sections
        const hasSections = parsed.sections && parsed.sections.length > 0;

        if (!hasSections) {
            throw new Error('Song has no sections - only a title. Cannot add to library.');
        }

        // Generate song ID
        const songId = generateSongId(parsed);
        const textHash = hashText(chordproText);

        // Check if song already exists
        const existingSong = await this.db.getSong(songId);

        if (existingSong) {
            const confirmed = confirm(`A song with this title already exists in your library. Do you want to update it?`);
            if (!confirmed) {
                throw new Error('Song already exists');
            }
        }

        // Create song entry
        const song = {
            id: songId,
            ccliNumber: metadata?.ccliNumber || parsed.metadata.ccliSongNumber || parsed.metadata.ccli || null,
            title: parsed.metadata.title || metadata?.title || 'Untitled',
            titleNormalized: normalizeTitle(parsed.metadata.title || metadata?.title || 'untitled'),
            artist: parsed.metadata.artist || metadata?.artist || null,
            chordproText: chordproText,
            metadata: {
                key: parsed.metadata.key || null,
                tempo: parsed.metadata.tempo || null,
                timeSignature: parsed.metadata.time || null
            },
            lyricsText: extractLyricsText(parsed),
            textHash: textHash,
            appearances: [],
            createdAt: new Date().toISOString(),
            lastUsedAt: new Date().toISOString()
        };

        // Save to database
        await this.db.saveSong(song);

        console.log('[CCLI] Song saved:', songId);

        return song;
    }
}

// Auto-initialize if on settings page
if (document.getElementById('check-imports-button')) {
    const handler = new CCLIImportsHandler();
    handler.init().catch(error => {
        console.error('[CCLI] Initialization failed:', error);
    });
}
