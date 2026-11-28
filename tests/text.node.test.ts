/**
 * What the app says (src/text/en.ts, docs/COPY.md): the catalogue is valid, every message the code asks
 * for is in it and every message in it is asked for, and `t()` and the dev editor's rewriting of a
 * message do what they say.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from '@fluent/syntax'
import { setTextTap, t } from '../src/js/text.ts'
import catalogue from '../src/text/en.ts'
import {
  fluentOf,
  listMessages,
  problemWith,
  replaceMessage,
} from '../vite-plugins/copy-catalogue.ts'

const MODULE = readFileSync('src/text/en.ts', 'utf8')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'text' ? [] : sourceFiles(path)
    return /\.(ts|js)$/.test(name) ? [path] : []
  })
}
const SOURCES = sourceFiles('src').map(path => ({ path, text: readFileSync(path, 'utf8') }))

test('the catalogue is valid Fluent, and the module is the file the editor reads', () => {
  assert.equal(problemWith(catalogue), null)
  assert.equal(fluentOf(MODULE), catalogue)
})

test('no message is in the catalogue twice (Fluent keeps the first and logs an error for the rest)', () => {
  const ids = parse(catalogue, {})
    .body.filter(entry => entry.type === 'Message' || entry.type === 'Term')
    .map(entry => `${entry.type === 'Term' ? '-' : ''}${entry.id.name}`)
  const twice = ids.filter((id, index) => ids.indexOf(id) !== index)
  assert.deepEqual(twice, [])
})

test('every message the code asks for is in the catalogue', () => {
  const ids = new Set(listMessages(MODULE).map(message => message.id))
  const missing: string[] = []
  for (const { path, text } of SOURCES) {
    for (const [, id] of text.matchAll(/\bt\('([a-z][a-z0-9-]*)'/g)) {
      if (!ids.has(id as string)) missing.push(`${path}: ${id}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('every message in the catalogue is used', () => {
  const resource = parse(catalogue, {})
  const code = SOURCES.map(source => source.text).join('\n')
  const unused = resource.body
    .filter(entry => entry.type === 'Message')
    .map(entry => entry.id.name)
    // (named in code as 't("id")', or passed on as a name: the quotes say it is not a mention in a comment)
    .filter(id => !new RegExp(`['"\`]${id}['"\`]`).test(code))
    // (or used by another message)
    .filter(id => !new RegExp(`\\{ ${id}\\b`).test(catalogue))
  assert.deepEqual(unused, [])
})

test('says a message with its values in, and a plural by the count', () => {
  assert.equal(t('toast-setlist-deleted', { title: 'Sunday' }), 'Deleted Sunday.')
  assert.equal(
    t('toast-teams-added-many', { count: 2, names: 'A, B' }),
    'Added 2 teams you are in: A, B.'
  )
})

test('says the name of a message there is none of, and says so', () => {
  const errors: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => void errors.push(args)
  try {
    assert.equal(t('there-is-no-such-message'), 'there-is-no-such-message')
  } finally {
    console.error = original
  }
  assert.equal(errors.length, 1)
})

test('lets the dev editor see, and change, what is said', () => {
  const seen: string[] = []
  setTextTap((key, text) => {
    seen.push(key)
    return `[${text}]`
  })
  try {
    assert.equal(t('action-undo'), '[Undo]')
  } finally {
    setTextTap(null)
  }
  assert.deepEqual(seen, ['action-undo'])
  assert.equal(t('action-undo'), 'Undo')
})

test('lists the messages with the comments written above them', () => {
  const message = listMessages(MODULE).find(each => each.id === 'toast-setlist-deleted')
  assert.equal(message?.source, 'Deleted { $title }.')
  assert.match(message?.comment ?? '', /offers Undo/)
})

test('rewrites one message and nothing else, in one line or several', () => {
  const several = replaceMessage(
    MODULE,
    'toast-setlist-deleted',
    'Gone: { $title }.\nIt can be undone.'
  )
  assert.equal(
    listMessages(several).find(each => each.id === 'toast-setlist-deleted')?.source,
    'Gone: { $title }.\nIt can be undone.'
  )
  assert.equal(replaceMessage(several, 'toast-setlist-deleted', 'Deleted { $title }.'), MODULE)
  // (the others, and the comments, are as they were)
  const others = (module: string) =>
    listMessages(module).filter(each => each.id !== 'toast-setlist-deleted')
  assert.deepEqual(others(several), others(MODULE))
})

test('refuses a rewrite that would break the catalogue, and says why', () => {
  assert.throws(() => replaceMessage(MODULE, 'action-undo', 'Undo { $'), /Expected/)
  assert.throws(() => replaceMessage(MODULE, 'action-undo', 'Undo `now`'), /backtick/)
  assert.throws(() => replaceMessage(MODULE, 'action-undo', '  '), /empty/)
  assert.throws(() => replaceMessage(MODULE, 'no-such-message', 'Hello'), /no message/)
})
