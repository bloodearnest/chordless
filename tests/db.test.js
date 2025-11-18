import { expect } from '@esm-bundle/chai';
import { suppressConsoleLogs } from './test-helpers.js';
const { describe, it } = window;

suppressConsoleLogs();
import { SetalightDB, createSetlist } from '../js/db.js';

const uniqueName = () =>
  crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

const deleteDatabase = name =>
  new Promise(resolve => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });

describe('SetalightDB', () => {
  let db;

  afterEach(async () => {
    if (db?.dbName) {
      await deleteDatabase(db.dbName);
      db = null;
    }
  });

  it('saves and retrieves setlist', async () => {
    const orgName = `TEST-${uniqueName()}`;
    db = new SetalightDB(orgName);
    await db.init();

    const setlist = createSetlist({
      date: '2024-09-01',
      time: '09:30',
      type: 'Church Service',
      name: 'Morning Service',
      owner: 'Alice',
    });

    setlist.songs.push({
      order: 0,
      songId: 'song-1',
      songUuid: 'uuid-1',
      key: null,
      tempo: null,
      notes: '',
    });

    await db.saveSetlist(setlist);

    const loaded = await db.getSetlist(setlist.id);
    expect(loaded.name).to.equal('Morning Service');
    expect(loaded.owner).to.equal('Alice');
    expect(loaded.songs).to.have.lengthOf(1);
  });
});
