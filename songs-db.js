// Abstract interface for song database
// Can be implemented by different backends (API, IndexedDB, etc.)

export class SongsDB {
    /**
     * Get list of all available setlists
     * @returns {Promise<Array<{id: string, date: string}>>}
     */
    async getSetlists() {
        throw new Error('Not implemented');
    }

    /**
     * Get list of songs in a setlist
     * @param {string} setlistId - The setlist identifier
     * @returns {Promise<Array<{filename: string, path: string}>>}
     */
    async getSongs(setlistId) {
        throw new Error('Not implemented');
    }

    /**
     * Get the content of a song file
     * @param {string} path - The path to the song file
     * @returns {Promise<string>}
     */
    async getSongContent(path) {
        throw new Error('Not implemented');
    }
}

// Temporary implementation that uses a backend API to access local files
export class FileSystemSongsDB extends SongsDB {
    constructor(apiBaseUrl = '') {
        super();
        this.apiBaseUrl = apiBaseUrl;
    }

    async getSetlists() {
        const response = await fetch(`${this.apiBaseUrl}/api/setlists`);
        if (!response.ok) {
            throw new Error(`Failed to fetch setlists: ${response.statusText}`);
        }
        return await response.json();
    }

    async getSongs(setlistId) {
        const response = await fetch(`${this.apiBaseUrl}/api/songs?setlist=${encodeURIComponent(setlistId)}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch songs: ${response.statusText}`);
        }
        return await response.json();
    }

    async getSongContent(path) {
        // Ensure path is absolute (starts with /)
        const absolutePath = path.startsWith('/') ? path : `/${path}`;
        const response = await fetch(absolutePath);
        if (!response.ok) {
            throw new Error(`Failed to fetch song content: ${response.statusText}`);
        }
        return await response.text();
    }
}

// Future implementation using IndexedDB (placeholder)
export class IndexedDBSongsDB extends SongsDB {
    constructor(dbName = 'setalight') {
        super();
        this.dbName = dbName;
        this.db = null;
    }

    async init() {
        // TODO: Initialize IndexedDB
        throw new Error('IndexedDB implementation not yet available');
    }

    async getSetlists() {
        // TODO: Implement IndexedDB version
        throw new Error('IndexedDB implementation not yet available');
    }

    async getSongs(setlistId) {
        // TODO: Implement IndexedDB version
        throw new Error('IndexedDB implementation not yet available');
    }

    async getSongContent(path) {
        // TODO: Implement IndexedDB version
        throw new Error('IndexedDB implementation not yet available');
    }
}
