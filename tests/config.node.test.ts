/** The Worker's secrets, declared once (worker/src/config.ts): checked at start, and named alike everywhere they are written down */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { configProblems, misconfigured, SECRETS } from '../worker/src/config.ts'

const key = `AIza${'x'.repeat(35)}`
const good = {
  JWE_ENCRYPTION_KEY: btoa('k'.repeat(32)),
  GOOGLE_CLIENT_ID: '123456789-abc123.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-abcdefghijkl',
  GOOGLE_API_KEY: key,
  PICKER_API_KEY: key,
}

test('a complete configuration has no problems, and the Picker key may be left out', () => {
  assert.deepEqual(configProblems(good), [])
  assert.deepEqual(configProblems({ ...good, PICKER_API_KEY: undefined }), [])
})

test('a missing required secret is named, with what it is for', () => {
  const problems = configProblems({ ...good, GOOGLE_CLIENT_SECRET: undefined, GOOGLE_API_KEY: '' })
  assert.equal(problems.length, 2)
  assert.match(problems[0], /^GOOGLE_CLIENT_SECRET is not set \(/)
  assert.match(problems[1], /^GOOGLE_API_KEY is not set/)
})

test('a mangled value is named without repeating it', () => {
  const env = {
    ...good,
    JWE_ENCRYPTION_KEY: 'not-base64!!',
    GOOGLE_CLIENT_ID: 'SECRET-LOOKING-VALUE',
    GOOGLE_CLIENT_SECRET: ' padded-secret-value ',
    GOOGLE_API_KEY: 'short',
    PICKER_API_KEY: 'AIza-too-short',
  }
  const problems = configProblems(env)
  assert.equal(problems.length, 5)
  for (const problem of problems) {
    assert.doesNotMatch(problem, /SECRET-LOOKING|padded-secret|not-base64|AIza-too/)
  }
  assert.deepEqual(configProblems({ ...good, JWE_ENCRYPTION_KEY: btoa('short') }), [
    'JWE_ENCRYPTION_KEY is not 32 bytes of base64',
  ])
  assert.deepEqual(configProblems({ ...good, GOOGLE_API_KEY: 5 }), [
    'GOOGLE_API_KEY is not a string',
  ])
})

test('the Worker answers its own paths with the problems, and leaves the page’s files alone', async () => {
  const bad = { ...good, GOOGLE_CLIENT_ID: undefined }
  const error = console.error
  const logged: string[] = []
  console.error = (message: string) => logged.push(message)
  try {
    for (const path of ['/oauth/callback', '/session/refresh', '/api/config', '/s/abc']) {
      const response = misconfigured(new Request(`https://x.test${path}`), bad)
      assert.equal(response?.status, 500, path)
      const body = (await response?.json()) as { error: string; problems: string[] }
      assert.equal(body.error, 'server_misconfigured')
      assert.match(body.problems[0], /^GOOGLE_CLIENT_ID is not set/)
    }
    assert.equal(misconfigured(new Request('https://x.test/songs'), bad), null)
    assert.equal(misconfigured(new Request('https://x.test/api/config'), good), null)
    // (said once, not at every request)
    assert.equal(logged.length, 1)
  } finally {
    console.error = error
  }
})

test('the development Worker says what is wrong and carries on', () => {
  const error = console.error
  const logged: string[] = []
  console.error = (message: string) => logged.push(message)
  try {
    const bad = { ...good, GOOGLE_CLIENT_SECRET: '', DEV_PAGES: 'true' }
    assert.equal(misconfigured(new Request('https://x.test/api/config'), bad), null)
  } finally {
    console.error = error
  }
})

test('every secret is listed in wrangler.toml and in .dev.vars.example, and they list no others', () => {
  const toml = readFileSync('wrangler.toml', 'utf8')
  const example = readFileSync('.dev.vars.example', 'utf8')
  const listed = [...toml.matchAll(/^# - (\w+):/gm)].map(match => match[1])
  const exampleNames = [...example.matchAll(/^([A-Z_]+)=/gm)].map(match => match[1])
  const declared = SECRETS.map(secret => secret.name)
  for (const name of declared) {
    assert.ok(listed.includes(name), `${name} is listed in wrangler.toml`)
    assert.ok(exampleNames.includes(name), `${name} is in .dev.vars.example`)
  }
  // (GOOGLE_REDIRECT_URI is a setting with a default, not a secret the Worker needs)
  for (const name of listed)
    assert.ok(declared.includes(name as never), `${name} is declared in config.ts`)
  for (const name of exampleNames.filter(name => name !== 'GOOGLE_REDIRECT_URI')) {
    assert.ok(
      declared.includes(name as never),
      `${name} (.dev.vars.example) is declared in config.ts`
    )
  }
})
