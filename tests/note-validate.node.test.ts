/**
 * Notes that arrive from outside (src/js/notes/validate.ts): the well formed text ones are kept, the
 * rest left out, and a drawing never gets in.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readSharedNotes } from '../src/js/notes/validate.ts'

const text = (id: string, anchor: unknown, extra: object = {}) => ({
  id,
  anchor,
  body: { kind: 'text', text: id },
  modified: '2026-11-01T00:00:00Z',
  ...extra,
})

test('anything that is not a list is no notes', () => {
  for (const value of [undefined, null, 'x', 5, {}]) assert.deepEqual(readSharedNotes(value), [])
})

test('keeps notes of every kind of anchor, and who made them', () => {
  const read = readSharedNotes([
    text('a', { kind: 'song' }),
    text('b', { kind: 'section', label: null, nth: 0 }, { createdBy: 'ann' }),
    text('c', {
      kind: 'text',
      label: 'Verse',
      nth: 1,
      line: 2,
      offset: 3,
      before: 'x',
      after: 'y',
    }),
  ])
  assert.deepEqual(
    read.map(note => [note.id, note.anchor.kind, note.createdBy]),
    [
      ['a', 'song', undefined],
      ['b', 'section', 'ann'],
      ['c', 'text', undefined],
    ]
  )
  assert.equal(readSharedNotes([{ ...text('a', { kind: 'song' }), modified: 5 }])[0]?.modified, '')
})

test('leaves out what is not well formed', () => {
  const bad = [
    'junk',
    null,
    text('', { kind: 'song' }),
    text('anchor-missing', undefined),
    text('anchor-unknown', { kind: 'elsewhere' }),
    text('section-no-nth', { kind: 'section', label: 'x' }),
    text('section-bad-nth', { kind: 'section', label: 'x', nth: -1 }),
    text('label-not-text', { kind: 'section', label: 3, nth: 0 }),
    text('text-incomplete', { kind: 'text', label: null, nth: 0, line: 0, offset: 0, before: '' }),
    { id: 'drawing', anchor: { kind: 'song' }, body: { kind: 'ink', strokes: [], w: 1, h: 1 } },
    { id: 'no-body', anchor: { kind: 'song' } },
    { id: 'no-words', anchor: { kind: 'song' }, body: { kind: 'text' } },
  ]
  assert.deepEqual(readSharedNotes(bad), [])
})
