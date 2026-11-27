/**
 * `just backup`: a copy of what Chordless holds on the server, on this computer (docs/BACKUP.md): the D1 database, as SQL,
 * and every object in the R2 bucket, kept by key. It reads with a Cloudflare token, never writes, and never deletes
 * anything on either side or in the copy. It holds people's email addresses and charts: `.backups/` is git-ignored and
 * private to its owner, and goes nowhere. It ends by checking the copy is whole (every object the database refers to is in
 * it, and each is the size the bucket said), and exits with an error if it is not.
 *
 *   node scripts/backup.ts [--out .backups/server]
 *
 * The bucket is read with a Cloudflare token: CLOUDFLARE_API_TOKEN, or the file `.cloudflare-token` (R2 read). The database is
 * exported by wrangler, with `wrangler login` or CLOUDFLARE_API_TOKEN, which must be allowed to read D1 (as `just db-backup` is).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  type BackupDeps,
  heldOnDisk,
  kindOf,
  type Listed,
  listEverything,
  mirror,
  missingReferences,
  writePrivate,
} from './backup-lib.ts'

const BUCKET = 'chordless-songs'
const DATABASE = 'chordless-teams'
const API = 'https://api.cloudflare.com/client/v4'

function token(): string {
  const fromEnv = process.env.CLOUDFLARE_API_TOKEN
  if (fromEnv) return fromEnv
  for (const file of ['.cloudflare-token', join(process.cwd(), '..', '.cloudflare-token')]) {
    if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  }
  throw new Error('No Cloudflare token: set CLOUDFLARE_API_TOKEN, or put one in .cloudflare-token')
}

const argument = (name: string) => {
  const at = process.argv.indexOf(name)
  return at < 0 ? undefined : process.argv[at + 1]
}

const TOKEN = token()
const out = argument('--out') ?? '.backups/server'

async function cloudflare(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...init.headers },
  })
  if (!response.ok) throw new Error(`Cloudflare ${response.status} for ${path.split('?')[0]}`)
  return response
}

async function accountId(): Promise<string> {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID
  const { result } = (await (await cloudflare('/accounts')).json()) as { result: { id: string }[] }
  if (result.length !== 1)
    throw new Error('The token sees more than one account: set CLOUDFLARE_ACCOUNT_ID')
  return result[0].id
}

/** The mirror's etags, from the manifests of earlier runs (newest wins) */
function knownEtags(root: string): Map<string, string> {
  const etags = new Map<string, string>()
  if (!existsSync(root)) return etags
  const runs = readdirSync(root)
    .filter(name => /^\d{8}T\d{6}Z$/.test(name))
    .sort()
  for (const run of runs) {
    const file = join(root, run, 'manifest.json')
    if (!existsSync(file)) continue
    for (const object of JSON.parse(readFileSync(file, 'utf8')) as Listed[])
      etags.set(object.key, object.etag)
  }
  return etags
}

const started = new Date()
const stamp = started
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d+Z$/, 'Z')
const run = join(out, stamp)
mkdirSync(run, { recursive: true, mode: 0o700 })

console.log(`Backing up to ${out}/ (run ${stamp})`)

// 1. The database (a token that cannot export it is told plainly, and the bucket is still copied: but the backup is not whole)
const problems: string[] = []
const sql = join(run, 'database.sql')
try {
  execFileSync('npx', ['wrangler', 'd1', 'export', DATABASE, '--remote', '--output', sql], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  console.log(`  database: ${Math.round(statSync(sql).size / 1024)} KB`)
} catch (error) {
  const said = String((error as { stderr?: Buffer }).stderr ?? '')
  const reason = /Authentication error|10000|permission/i.test(said)
    ? 'wrangler is not allowed to export the database (log in with `wrangler login`, or set CLOUDFLARE_API_TOKEN to a token with the D1 permission, as `just db-backup` needs)'
    : 'wrangler could not export it'
  console.error(`  database: NOT SAVED: ${reason}`)
  problems.push(`the database was not saved: ${reason}`)
}

// 2. The bucket
const account = await accountId()
const bucket = `/accounts/${account}/r2/buckets/${BUCKET}/objects`
const root = join(out, 'r2')
const etags = knownEtags(out)
const deps: BackupDeps = {
  async page(cursor) {
    const query = new URLSearchParams({ per_page: '1000', ...(cursor ? { cursor } : {}) })
    const body = (await (await cloudflare(`${bucket}?${query}`)).json()) as {
      result: { key: string; etag: string; size: number }[]
      result_info?: { cursor?: string; is_truncated?: boolean }
    }
    return {
      objects: body.result.map(({ key, etag, size }) => ({ key, etag, size })),
      next: body.result_info?.is_truncated ? (body.result_info.cursor ?? null) : null,
    }
  },
  async fetch(key) {
    const encoded = key.split('/').map(encodeURIComponent).join('/')
    return new Uint8Array(await (await cloudflare(`${bucket}/${encoded}`)).arrayBuffer())
  },
  held: heldOnDisk(root, etags),
}
const listed = await listEverything(deps)
const report = await mirror(root, listed, deps)
writePrivate(join(run, 'manifest.json'), JSON.stringify(listed, null, 1))
const kinds = { song: 0, pdf: 0, pad: 0, other: 0 }
for (const object of listed) kinds[kindOf(object.key)]++
console.log(
  `  bucket: ${report.listed} objects (${kinds.song} song bundles, ${kinds.pdf} PDFs, ${kinds.pad} pads, ${kinds.other} other); ` +
    `${report.saved} saved (${Math.round(report.bytes / 1024)} KB), ${report.unchanged} already there, ${report.replaced} changed since the last backup`
)

// 3. Is it whole: every object the database refers to is in the bucket's list, and each copy is the size it was said to be
let missing: string[] = []
try {
  const referenced = JSON.parse(
    execFileSync(
      'npx',
      [
        'wrangler',
        'd1',
        'execute',
        DATABASE,
        '--remote',
        '--json',
        '--command',
        'SELECT bundle_ref FROM library_songs WHERE bundle_ref IS NOT NULL',
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
  )[0].results.map((row: { bundle_ref: string }) => row.bundle_ref) as string[]
  missing = missingReferences(listed, referenced)
  console.log(
    `  check: ${referenced.length} song bundles the database refers to, ${missing.length} missing from the bucket`
  )
} catch {
  console.error(
    '  check: NOT DONE: the database could not be read, so what it refers to was not compared with the bucket'
  )
  problems.push('the copy was not checked against the database')
}
for (const gap of missing.slice(0, 10)) console.error(`    missing: ${gap}`)
for (const failure of report.failed.slice(0, 10))
  console.error(`    failed: ${failure.key}: ${failure.reason}`)
if (missing.length)
  problems.push(`${missing.length} objects the database refers to are not in the bucket`)
if (report.failed.length) problems.push(`${report.failed.length} objects could not be copied whole`)
if (problems.length) {
  console.error('\nThe backup is NOT whole:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(
  `Done in ${Math.round((Date.now() - started.getTime()) / 1000)} s. Restoring: docs/BACKUP.md`
)
