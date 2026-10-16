// Every picture the Help pages name is in public/help/, for the light theme and the dark
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
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
