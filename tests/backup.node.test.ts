import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  type BackupDeps,
  heldOnDisk,
  kindOf,
  type Listed,
  listEverything,
  mirror,
  mirrorPath,
  missingReferences,
  writePrivate,
} from '../scripts/backup-lib.ts'

const bytes = (text: string) => new TextEncoder().encode(text)
const object = (key: string, text: string, etag = `e-${text}`): Listed => ({
  key,
  etag,
  size: bytes(text).byteLength,
})

test('the whole bucket is listed, following the cursor to the end', async () => {
  const pages = new Map<string | null, { objects: Listed[]; next: string | null }>([
    [null, { objects: [object('a', '1'), object('b', '22')], next: 'c1' }],
    ['c1', { objects: [object('c', '333')], next: 'c2' }],
    ['c2', { objects: [], next: null }],
  ])
  const asked: (string | null)[] = []
  const all = await listEverything({
    page: async cursor => {
      asked.push(cursor)
      return pages.get(cursor) as { objects: Listed[]; next: string | null }
    },
  })
  assert.deepEqual(
    all.map(each => each.key),
    ['a', 'b', 'c']
  )
  assert.deepEqual(asked, [null, 'c1', 'c2'])
})

test('a key is kept under the mirror, and nothing is written outside it', () => {
  const root = mkdtempSync(join(tmpdir(), 'mirror-'))
  try {
    assert.equal(
      mirrorPath(root, 'library/a/songs/b/c.json'),
      join(root, 'library/a/songs/b/c.json')
    )
    assert.throws(() => mirrorPath(root, '../escape'), /Not a key to keep/)
    assert.throws(() => mirrorPath(root, '/etc/passwd'), /Not a key to keep/)
    assert.throws(() => mirrorPath(root, 'a/../../x'), /Not a key to keep/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the mirror saves what is new, leaves what is the same, and keeps what changed beside the new one', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mirror-'))
  try {
    const data = new Map<string, string>([
      ['library/l/pads/p/C.mp3', 'one'],
      ['library/l/songs/s/h.json', '{"a":1}'],
    ])
    const etags = new Map<string, string>()
    const listed = (): Listed[] => [...data].map(([key, text]) => object(key, text))
    const deps = (): BackupDeps => ({
      page: async () => ({ objects: listed(), next: null }),
      fetch: async key => bytes(data.get(key) as string),
      held: heldOnDisk(root, etags),
    })
    const first = await mirror(root, listed(), deps())
    assert.deepEqual(
      { ...first, bytes: undefined },
      { listed: 2, saved: 2, unchanged: 0, replaced: 0, bytes: undefined, failed: [] }
    )
    for (const each of listed()) etags.set(each.key, each.etag)
    // (readable by its owner alone)
    assert.equal(statSync(join(root, 'library/l/songs/s/h.json')).mode & 0o077, 0)

    // nothing changed: nothing fetched
    const again = await mirror(root, listed(), {
      ...deps(),
      fetch: async () => {
        throw new Error('fetched')
      },
    })
    assert.deepEqual(
      { saved: again.saved, unchanged: again.unchanged, failed: again.failed.length },
      { saved: 0, unchanged: 2, failed: 0 }
    )

    // a pad is replaced: the old one is kept
    data.set('library/l/pads/p/C.mp3', 'two-longer')
    const changed = await mirror(root, listed(), deps())
    assert.equal(changed.replaced, 1)
    assert.equal(readFileSync(join(root, 'library/l/pads/p/C.mp3'), 'utf8'), 'two-longer')
    assert.equal(readFileSync(join(root, 'library/l/pads/p/C.mp3.replaced-e-one'), 'utf8'), 'one')

    // an object that is no longer listed is not removed from the mirror
    data.delete('library/l/songs/s/h.json')
    await mirror(root, listed(), deps())
    assert.equal(readFileSync(join(root, 'library/l/songs/s/h.json'), 'utf8'), '{"a":1}')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an object that comes back the wrong size, or cannot be fetched, is reported and the rest carry on', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mirror-'))
  try {
    const listed = [
      object('good', 'fine'),
      object('short', 'complete'),
      object('gone', 'x'),
      object('also-good', 'ok'),
    ]
    const report = await mirror(
      root,
      listed,
      {
        fetch: async key => {
          if (key === 'short') return bytes('cut')
          if (key === 'gone') throw new Error('Cloudflare 404')
          return bytes(key === 'good' ? 'fine' : 'ok')
        },
        held: () => null,
      },
      2
    )
    assert.equal(report.saved, 2)
    assert.deepEqual(report.failed.map(each => each.key).sort(), ['gone', 'short'])
    assert.match(
      report.failed.find(each => each.key === 'short')?.reason ?? '',
      /3 bytes, not the 8 listed/
    )
    assert.equal(existsSync(join(root, 'short')), false, 'a cut object is not kept as if whole')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an object the database refers to that the bucket does not list is a gap in the backup', () => {
  const listed = [
    object('library/l/songs/a/h1.json', '1'),
    object('library/l/songs/b/h2.json', '2'),
  ]
  assert.deepEqual(
    missingReferences(listed, ['library/l/songs/a/h1.json', 'library/l/songs/c/h3.json']),
    ['library/l/songs/c/h3.json']
  )
  assert.deepEqual(missingReferences(listed, []), [])
})

test('what the objects are is told by where they are kept', () => {
  assert.equal(kindOf('library/L/songs/S/pdf/9999-abc.pdf'), 'pdf')
  assert.equal(kindOf('library/L/pads/P/C#.mp3'), 'pad')
  assert.equal(kindOf('library/L/songs/S/0123abcd.json'), 'song')
  assert.equal(kindOf('shares/x/bundle.json'), 'other')
})

test('a file of people’s data is written readable by its owner alone', () => {
  const root = mkdtempSync(join(tmpdir(), 'mirror-'))
  try {
    writePrivate(join(root, 'a/b/manifest.json'), '[]')
    assert.equal(statSync(join(root, 'a/b/manifest.json')).mode & 0o077, 0)
    assert.equal(statSync(join(root, 'a/b')).mode & 0o077, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
