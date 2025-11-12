import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { SetalightDB } from '../js/db.js';

test('getSongUsageFromSetlists aggregates appearances', async () => {
    const db = new SetalightDB('TEST');
    await db.init();

    const setlists = [
        {
            id: 'set1',
            date: '2024-01-01',
            name: 'New Year',
            leader: 'Leader A',
            songs: [
                { songId: 'song-1', modifications: { targetKey: 'C' } },
                { songId: 'song-2', modifications: { targetKey: 'G' } }
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        },
        {
            id: 'set2',
            date: '2024-02-01',
            name: 'February',
            leader: 'Leader B',
            songs: [
                { songId: 'song-1', modifications: { targetKey: 'D' } }
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    ];

    for (const setlist of setlists) {
        await db.saveSetlist(setlist);
    }

    const usage = await db.getSongUsageFromSetlists('song-1');
    assert.equal(usage.length, 2);
    assert.equal(usage[0].leader, 'Leader B'); // sorted by date desc
    assert.equal(usage[1].leader, 'Leader A');
});
