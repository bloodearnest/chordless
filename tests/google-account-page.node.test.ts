// The page that shows how to make a Google account with an address that is not Gmail's
// (src/google-account.html) names pictures of Google's sign-up; they are taken by hand
// (`just google-account-images`), so this fails if one is missing or the page names one that is not
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

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
