// Writes .dev.vars for local development from what can be looked up (docs/ENVIRONMENTS.md):
// `just dev-vars`. Nothing secret is printed.
//
// - GOOGLE_CLIENT_ID: the dev client in .env.development
// - GOOGLE_API_KEY, PICKER_API_KEY: the dev project's two keys, from gcloud (their ids come from
//   Terraform: infra/google-dev/)
// - JWE_ENCRYPTION_KEY: made new, if there is none
// - GOOGLE_CLIENT_SECRET: not in gcloud or Terraform (the console shows it once, at creation, or
//   makes a new one): taken from the environment variable DEV_CLIENT_SECRET, or asked for
//
// A .dev.vars whose client is not the dev one (it holds production's, as it used to) is moved to
// .dev.vars.prod-backup first; otherwise values already there are kept, and only gaps are filled.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { ask } from './ask.ts'
import { fillTemplate, isOtherEnvironment, parseVars } from './dev-vars-lib.ts'

const FILE = '.dev.vars'
const BACKUP = '.dev.vars.prod-backup'
const PROJECT = 'chordless-dev'

const run = (command: string, args: string[], cwd?: string) =>
  execFileSync('mise', ['exec', '--', command, ...args], { cwd, encoding: 'utf8' }).trim()

const clientId = parseVars(readFileSync('.env.development', 'utf8')).VITE_GOOGLE_CLIENT_ID
if (!clientId) throw new Error('.env.development has no VITE_GOOGLE_CLIENT_ID')

let existing = existsSync(FILE) ? parseVars(readFileSync(FILE, 'utf8')) : {}
if (isOtherEnvironment(existing, clientId)) {
  if (existsSync(BACKUP)) {
    throw new Error(`${FILE} is for another client, and ${BACKUP} is already there: move one away`)
  }
  renameSync(FILE, BACKUP)
  chmodSync(BACKUP, 0o600)
  console.log(`${FILE} was for another client (production's): moved to ${BACKUP}.`)
  existing = {}
}

const keyString = (output: string) =>
  run('gcloud', [
    'services',
    'api-keys',
    'get-key-string',
    output,
    '--project',
    PROJECT,
    '--format=value(keyString)',
  ])
const terraformOutput = (name: string) =>
  run('terraform', ['output', '-raw', name], 'infra/google-dev')

const values: Record<string, string | undefined> = { ...existing, GOOGLE_CLIENT_ID: clientId }
const filled: string[] = []
const fill = async (name: string, make: () => string | Promise<string>) => {
  if (values[name]) return
  values[name] = await make()
  if (values[name]) filled.push(name)
}

await fill('GOOGLE_API_KEY', () => keyString(terraformOutput('sharing_key_uid')))
await fill('PICKER_API_KEY', () => keyString(terraformOutput('team_key_uid')))
await fill('JWE_ENCRYPTION_KEY', () => randomBytes(32).toString('base64'))
await fill(
  'GOOGLE_CLIENT_SECRET',
  async () =>
    process.env.DEV_CLIENT_SECRET ??
    (process.stdin.isTTY
      ? await ask(
          `Client secret of ${clientId.split('-')[0]}… (console: project ${PROJECT}; not shown): `,
          { hidden: true }
        )
      : '')
)

writeFileSync(FILE, fillTemplate(readFileSync('.dev.vars.example', 'utf8'), values), {
  mode: 0o600,
})
chmodSync(FILE, 0o600)
console.log(`Wrote ${FILE}. Filled in: ${filled.join(', ') || 'nothing (all were there)'}.`)
const blank = [
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_API_KEY',
  'PICKER_API_KEY',
  'JWE_ENCRYPTION_KEY',
].filter(name => !values[name])
if (blank.length > 0) console.log(`Still empty: ${blank.join(', ')}.`)
