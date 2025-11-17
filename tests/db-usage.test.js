import { expect } from '@esm-bundle/chai';
import { suppressConsoleLogs } from './test-helpers.js';
const { describe, it } = window;

suppressConsoleLogs();
import { SetalightDB } from '../js/db.js';

const uniqueName = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

const deleteDatabase = name =>
  new Promise(resolve => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });

describe('SetalightDB usage aggregation', () => {
  let db;

  afterEach(async () => {
    if (db?.dbName) {
      await deleteDatabase(db.dbName);
      db = null;
    }
  });

  it('aggregates song appearances across setlists', async () => {
    const orgName = `TEST-${uniqueName()}`;
    db = new SetalightDB(orgName);
    await db.init();

    const setlists = [
      {
        id: 'set1',
        date: '2024-01-01',
        name: 'New Year',
        leader: 'Leader A',
        songs: [
          { songId: 'song-1', modifications: { targetKey: 'C' } },
          { songId: 'song-2', modifications: { targetKey: 'G' } },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'set2',
        date: '2024-02-01',
        name: 'February',
        leader: 'Leader B',
        songs: [{ songId: 'song-1', modifications: { targetKey: 'D' } }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    for (const setlist of setlists) {
      await db.saveSetlist(setlist);
    }

    const usage = await db.getSongUsageFromSetlists('song-1');
    expect(usage).to.have.lengthOf(2);
    expect(usage[0].leader).to.equal('Leader B'); // sorted by date desc
    expect(usage[1].leader).to.equal('Leader A');
  });
});
