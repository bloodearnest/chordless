/** Dev and prod use different Google Cloud projects (docs/ENVIRONMENTS.md), and the page cannot slip back to one */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const envFile = (name: string) =>
  Object.fromEntries(
    readFileSync(name, 'utf8')
      .split('\n')
      .filter(line => /^[A-Z_]+=/.test(line))
      .map(line => line.split(/=(.*)/s).slice(0, 2))
  ) as Record<string, string>

const dev = envFile('.env.development')
const prod = envFile('.env.production')

test('each environment names its client and its Picker app (the project number)', () => {
  for (const env of [dev, prod]) {
    const [project] = env.VITE_GOOGLE_CLIENT_ID.split('-')
    assert.match(env.VITE_GOOGLE_CLIENT_ID, /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/)
    assert.equal(
      env.VITE_PICKER_APP_ID,
      project,
      'the Picker app id is the client’s project number'
    )
  }
})

test('dev and prod are different projects, with different clients', () => {
  assert.notEqual(dev.VITE_PICKER_APP_ID, prod.VITE_PICKER_APP_ID)
  assert.notEqual(dev.VITE_GOOGLE_CLIENT_ID, prod.VITE_GOOGLE_CLIENT_ID)
})

test('the page takes its project from the environment, and names none itself', () => {
  for (const file of ['src/js/google-auth.ts', 'src/js/folder-picker.ts']) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /\d{9,}-[a-z0-9]+\.apps\.googleusercontent\.com/, file)
    assert.doesNotMatch(source, /['"]\d{12}['"]/, `${file} has a project number in it`)
  }
})

test('.dev.vars.example names every secret wrangler.toml lists', () => {
  const example = readFileSync('.dev.vars.example', 'utf8')
  const toml = readFileSync('wrangler.toml', 'utf8')
  const secrets = [...toml.matchAll(/^# - (\w+):/gm)].map(match => match[1])
  assert.ok(secrets.length >= 5, 'wrangler.toml lists the secrets')
  for (const name of secrets) {
    assert.match(example, new RegExp(`^${name}=`, 'm'), `${name} is in .dev.vars.example`)
  }
})
