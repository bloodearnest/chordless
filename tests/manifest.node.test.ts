/**
 * The web app manifest's install-only features point at places in the app: a shortcut at a page,
 * the file handler and share target at the import page. These keep them from pointing at
 * a page that does not exist, and keep the icons real.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { matchRoute } from '../src/js/router.ts'

const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))

/** A path of the app that is a view (not the not-found page) */
const isView = (path: string) => matchRoute(path).name !== 'not-found'

test('every shortcut goes to a page of the app, and has a real icon', () => {
  assert.ok(manifest.shortcuts.length > 0)
  for (const shortcut of manifest.shortcuts) {
    assert.ok(shortcut.name, 'a shortcut has a name')
    assert.ok(isView(shortcut.url), `${shortcut.url} is a page of the app`)
    for (const icon of shortcut.icons ?? []) {
      assert.ok(existsSync(`public${icon.src}`), `${icon.src} exists`)
    }
  }
})

test('opening a ChordPro file goes to the import page, for the extensions a chart has', () => {
  const [handler] = manifest.file_handlers
  assert.equal(handler.action, '/import-song')
  assert.ok(isView(handler.action))
  const extensions = Object.values(handler.accept).flat()
  for (const extension of ['.cho', '.chordpro']) assert.ok(extensions.includes(extension))
  // Not every text file: Chordless should not become what opens .txt
  assert.ok(!extensions.includes('.txt'))
})

test('a share is a POST of files and text to the address the service worker handles', () => {
  const target = manifest.share_target
  assert.equal(target.action, '/share-target')
  assert.equal(target.method, 'POST')
  assert.equal(target.enctype, 'multipart/form-data')
  // The names the service worker reads (shared-incoming.ts)
  assert.equal(target.params.text, 'text')
  assert.equal(target.params.files[0].name, 'files')
  // It is not a page of its own: the service worker answers it with a redirect
  assert.ok(!isView(target.action))
})

test('a second window is not made for a launch', () => {
  assert.equal(manifest.launch_handler.client_mode, 'focus-existing')
})
