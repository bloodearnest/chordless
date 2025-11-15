import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSetlists, reconcileSongs } from '../js/sync/reconciler.js';

const now = (offset = 0) => new Date(Date.now() + offset).toISOString();

test('setlist: upload local-only record', () => {
  const plan = reconcileSetlists([{ id: '2024-01-01', updatedAt: now() }], []);

  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, 'upload');
  assert.equal(plan[0].entityType, 'setlist');
  assert.equal(plan[0].id, '2024-01-01');
});

test('setlist: download remote-only record', () => {
  const plan = reconcileSetlists([], [{ id: '2024-01-01', updatedAt: now() }]);

  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, 'download');
  assert.equal(plan[0].entityType, 'setlist');
});

test('setlist: prefer newer timestamp', () => {
  const local = { id: 'set1', updatedAt: '2024-01-01T00:00:00.000Z' };
  const remote = { id: 'set1', updatedAt: '2024-02-01T00:00:00.000Z' };
  const plan = reconcileSetlists([local], [remote]);
  assert.equal(plan[0].action, 'download');
});

test('setlist: prefer remote on equal timestamps', () => {
  const updatedAt = '2024-01-01T00:00:00.000Z';
  const plan = reconcileSetlists([{ id: 'set1', updatedAt }], [{ id: 'set1', updatedAt }]);
  assert.equal(plan[0].action, 'download');
});

test('setlist: delete remote when removed locally', () => {
  const plan = reconcileSetlists(
    [{ id: 'set1', updatedAt: now(), deletedAt: now() }],
    [{ id: 'set1', updatedAt: now() }]
  );
  assert.equal(plan[0].action, 'deleteRemote');
});

test('song: delete local when removed remotely', () => {
  const plan = reconcileSongs(
    [{ id: 'song1', updatedAt: now() }],
    [{ id: 'song1', updatedAt: now(), deletedAt: now() }]
  );
  assert.equal(plan[0].action, 'deleteLocal');
});

test('song: upload and download mix', () => {
  const plan = reconcileSongs(
    [{ id: 'song-local', updatedAt: now() }],
    [{ id: 'song-remote', updatedAt: now() }]
  );
  assert.equal(plan.length, 2);
  assert.ok(plan.some(entry => entry.action === 'upload'));
  assert.ok(plan.some(entry => entry.action === 'download'));
});
