/**
 * App events are Event subclasses, each with a namespaced static type
 * ('component:event'), defined in the module that sends it. These tests keep
 * event names from colliding, and catch listeners naming an event that
 * doesn't exist (a typo there fails silently in the browser).
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

/** The app's own source files (not vendored libraries or dev pages) */
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory())
      return entry.name === 'vendor' || entry.name === 'dev' ? [] : sourceFiles(path)
    return /\.(js|html)$/.test(entry.name) ? [path] : []
  })
}

const files = sourceFiles('public').map(path => ({ path, text: readFileSync(path, 'utf8') }))

/** [{name, type, path}] for every `class X extends Event { static type = '...' }` */
const events = files.flatMap(({ path, text }) =>
  [...text.matchAll(/class (\w+) extends Event \{\s*static type = '([^']+)'/g)].map(m => ({
    name: m[1],
    type: m[2],
    path,
  }))
)
const types = new Set(events.map(e => e.type))

test('there are event classes to check', () => {
  assert.ok(events.length > 30, `found only ${events.length}`)
})

test('every event type is defined once', () => {
  const seen = new Map()
  for (const event of events) {
    const first = seen.get(event.type)
    assert.ok(
      !first,
      `${event.type}: ${first?.name} in ${first?.path}, and ${event.name} in ${event.path}`
    )
    seen.set(event.type, event)
  }
})

test('event types are namespaced: component:event', () => {
  for (const { name, type } of events) {
    assert.match(type, /^[a-z][a-z-]*:[a-z][a-z-]*$/, `${name}: ${type}`)
  }
})

test('events are sent as Event subclasses, not bare CustomEvents', () => {
  for (const { path, text } of files) {
    assert.ok(!text.includes('new CustomEvent('), `${path} creates a CustomEvent`)
  }
})

test('every namespaced event listened for is defined', () => {
  for (const { path, text } of files) {
    const listened = [
      ...text.matchAll(/@([a-z][a-z-]*:[a-z][a-z-]*)=/g), // Lit template bindings
      ...text.matchAll(/EventListener\('([a-z][a-z-]*:[a-z][a-z-]*)'/g), // string literals
    ].map(m => m[1])
    for (const type of listened) {
      assert.ok(types.has(type), `${path} listens for ${type}, which no event class defines`)
    }
  }
})
