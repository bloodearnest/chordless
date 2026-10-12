/** The preview tags the worker adds to /s/<id> (worker/src/share-page.ts) */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { withSharePreview } from '../worker/src/share-page.ts'

const index = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8')

test('a share link previews as a shared setlist, not as the app', () => {
  const page = withSharePreview(index, 'https://chordless.app')
  assert.match(page, /<title>A setlist shared with you - Chordless<\/title>/)
  assert.match(page, /property="og:title" content="A setlist shared with you"/)
  assert.match(page, /property="og:image" content="https:\/\/chordless\.app\/icons\/icon-512\.png"/)
  assert.match(page, /name="description" content="Open the link to see the songs and chords/)
  assert.ok(!page.includes('Setlist arrangement for worship songs'))
})

test('it asks not to be indexed, and the tags are inside the head', () => {
  const page = withSharePreview(index, 'https://chordless.app')
  const head = page.slice(page.indexOf('<head>'), page.indexOf('</head>'))
  assert.match(head, /name="robots" content="noindex, nofollow"/)
  assert.ok(head.includes('og:title'))
})

test('the origin is escaped into the tag', () => {
  const page = withSharePreview(index, 'https://x.test/"><script>')
  assert.ok(!page.includes('"><script>'))
})
