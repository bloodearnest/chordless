/**
 * The sample charts the welcome card offers (public/samples): each is a real chart, the words
 * are credited as public domain, the chords to the project's author (never CCLI), and none
 * carries a CCLI number (they must not count as SongSelect songs).
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ChordProParser } from '../src/js/parser.ts'

const DIR = 'public/samples'
const index = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8'))
const parser = new ChordProParser()

test('the index lists the chart files, each once, and every chart is in it', () => {
  const files = readdirSync(DIR).filter(name => name.endsWith('.chordpro'))
  assert.deepEqual([...index.songs].sort(), files.sort())
  assert.equal(new Set(index.songs).size, index.songs.length)
  assert.ok(index.setlistName)
})

for (const file of index.songs) {
  test(`${file} is a complete chart with the right credits`, () => {
    const chart = readFileSync(`${DIR}/${file}`, 'utf8')
    const { metadata, sections } = parser.parse(chart)
    assert.ok(metadata.title, 'a title')
    assert.ok(metadata.key, 'a key')
    assert.ok(sections.length >= 4, 'at least four sections')
    assert.ok(
      sections.every(section => section.lines.length >= 2),
      'no empty section'
    )
    assert.match(chart, /\[[A-G][^\]]*\]/, 'has chords')
    assert.match(metadata.copyright ?? '', /public domain/i)
    assert.match(metadata.copyright ?? '', /Chords © 2026 Simon Davy/)
    assert.doesNotMatch(chart, /ccli/i, 'no CCLI number or credit')
  })
}
