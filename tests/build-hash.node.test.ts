/** The hash of a build (scripts/build-hash.ts): the same for the same files wherever they were built, and different when any changes */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { hashBuild } from '../scripts/build-hash.ts'

const build = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'build-hash-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return dir
}

const config = (path: string) => JSON.stringify({ configPath: path, name: 'chordless' })

test('the same files hash the same, wherever the checkout was', () => {
  const a = build({
    'client/a.js': 'one',
    'chordless/wrangler.json': config('/home/a/wrangler.toml'),
  })
  const b = build({
    'chordless/wrangler.json': config('/runner/b/wrangler.toml'),
    'client/a.js': 'one',
  })
  try {
    assert.equal(hashBuild(a), hashBuild(b))
  } finally {
    rmSync(a, { recursive: true })
    rmSync(b, { recursive: true })
  }
})

test('a changed file, a renamed file or a changed setting changes the hash', () => {
  const files = { 'client/a.js': 'one', 'chordless/wrangler.json': config('/x') }
  const dirs = [
    build(files),
    build({ ...files, 'client/a.js': 'two' }),
    build({ 'client/b.js': 'one', 'chordless/wrangler.json': config('/x') }),
    build({ ...files, 'chordless/wrangler.json': JSON.stringify({ name: 'other' }) }),
  ]
  try {
    assert.equal(new Set(dirs.map(hashBuild)).size, dirs.length)
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true })
  }
})

test('the version file the hash is written to does not change the hash', () => {
  const dir = build({ 'client/a.js': 'one' })
  try {
    const before = hashBuild(dir)
    writeFileSync(join(dir, 'client/version.json'), '{"hash":"x"}')
    assert.equal(hashBuild(dir), before)
  } finally {
    rmSync(dir, { recursive: true })
  }
})
