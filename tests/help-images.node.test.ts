// Every picture the Help pages name is in public/help/, for the light theme and the dark; and the pictures
// of Google's sign-up that src/google-account.html names are in public/google-account/ (both are taken by hand or by `just`)
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { helpFor } from '../src/js/help-content.ts'
import type { Route } from '../src/js/router.ts'

const routes: Route[] = [
  { name: 'setlist', setlistId: 'a', songIndex: -1 },
  { name: 'setlist', setlistId: 'a', songIndex: 0 },
  { name: 'songs' },
]

test('the pictures the Help pages name have been taken (just help-images)', () => {
  const missing: string[] = []
  for (const route of routes) {
    for (const section of helpFor(route)?.sections ?? []) {
      for (const { image } of section.items ?? []) {
        if (!image) continue
        for (const file of [`${image}.png`, `${image}-dark.png`]) {
          if (!existsSync(`public/help/${file}`)) missing.push(file)
        }
      }
    }
  }
  assert.deepEqual(missing, [])
})

test('every picture the Google account page names has been taken, and none is left over', () => {
  const page = readFileSync('src/google-account.html', 'utf8')
  const named = [...page.matchAll(/src="\/google-account\/([^"]+)"/g)].map(match => match[1]).sort()
  assert.ok(named.length >= 4, 'the page shows the steps')
  assert.deepEqual(
    named.filter(file => !existsSync(`public/google-account/${file}`)),
    []
  )
  assert.deepEqual(readdirSync('public/google-account').sort(), named)
})

test('the page is built with the others, and is not kept for offline (it is seen once, online)', () => {
  assert.match(readFileSync('vite.config.ts', 'utf8'), /'google-account'/)
  assert.match(
    readFileSync('vite-plugins/service-worker.ts', 'utf8'),
    /startsWith\('google-account\/'\)/
  )
})
