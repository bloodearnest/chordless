/**
 * Annotations that arrive from outside (src/js/annotations/validate.ts): the well formed text ones are kept, the
 * rest left out, and a drawing never gets in.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readSharedAnnotations } from '../src/js/annotations/validate.ts'

const text = (id: string, anchor: unknown, extra: object = {}) => ({
  id,
  anchor,
  body: { kind: 'text', text: id },
  modified: '2026-11-01T00:00:00Z',
  ...extra,
})

test('anything that is not a list is no annotations', () => {
  for (const value of [undefined, null, 'x', 5, {}])
    assert.deepEqual(readSharedAnnotations(value), [])
})

test('keeps annotations of every kind of anchor, and who made them', () => {
  const read = readSharedAnnotations([
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
    read.map(annotation => [annotation.id, annotation.anchor.kind, annotation.createdBy]),
    [
      ['a', 'song', undefined],
      ['b', 'section', 'ann'],
      ['c', 'text', undefined],
    ]
  )
  assert.equal(
    readSharedAnnotations([{ ...text('a', { kind: 'song' }), modified: 5 }])[0]?.modified,
    ''
  )
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
  assert.deepEqual(readSharedAnnotations(bad), [])
})

test('keeps the snapshot of an anchor, cut short, and leaves out what is not text', () => {
  const long = 'x'.repeat(500)
  const [read] = readSharedAnnotations([
    text('a', {
      kind: 'text',
      label: 'Verse',
      nth: 0,
      line: 1,
      offset: 2,
      before: 'a',
      after: 'b',
      lineText: long,
      prevLine: 'above',
      nextLine: 7,
      occ: 2,
      sectionHead: 'first line',
    }),
  ])
  const anchor = read?.anchor as Record<string, unknown>
  assert.equal((anchor.lineText as string).length, 200)
  assert.equal(anchor.prevLine, 'above')
  assert.equal('nextLine' in anchor, false)
  assert.equal(anchor.occ, 2)
  assert.equal(anchor.sectionHead, 'first line')
  const [section] = readSharedAnnotations([
    text('b', { kind: 'section', label: null, nth: 0, sectionHead: 'head' }),
  ])
  assert.equal(((section?.anchor ?? {}) as Record<string, unknown>).sectionHead, 'head')
})
