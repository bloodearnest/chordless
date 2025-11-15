import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { SetalightDB, createSetlist } from '../js/db.js';

test('SetalightDB saves and retrieves setlist', async () => {
  const db = new SetalightDB('TEST');
  await db.init();

  const setlist = createSetlist({
    date: '2024-09-01',
    time: '09:30',
    type: 'Church Service',
    name: 'Morning Service',
    leader: 'Alice',
  });

  setlist.songs.push({ songId: 'song-1', modifications: {} });

  await db.saveSetlist(setlist);

  const loaded = await db.getSetlist(setlist.id);
  assert.deepEqual(loaded.name, 'Morning Service');
  assert.equal(loaded.leader, 'Alice');
  assert.equal(loaded.songs.length, 1);
});
