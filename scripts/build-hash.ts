// A hash of everything a deploy ships (dist/), so CI can skip a deploy that would change nothing
// (docs/CI.md). It is written to dist/client/version.json, which the Worker serves as /version.json:
// the deploy compares it with the live site's, so what is compared is what is running.
// The build is reproducible; the one thing in it that is not is wrangler.json's paths to the config
// (they name the checkout), which are left out. Usage: node scripts/build-hash.ts [dist]
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const VERSION_FILE = 'client/version.json'
const MACHINE_KEYS = ['configPath', 'userConfigPath']

const filesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap(entry =>
      entry.isDirectory() ? filesIn(join(dir, entry.name)) : [join(dir, entry.name)]
    )
    .sort()

const contentOf = (path: string): Buffer => {
  const bytes = readFileSync(path)
  if (!path.endsWith('wrangler.json')) return bytes
  const config = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
  for (const key of MACHINE_KEYS) delete config[key]
  return Buffer.from(JSON.stringify(config))
}

export const hashBuild = (dist: string): string => {
  const hash = createHash('sha256')
  for (const path of filesIn(dist)) {
    const name = relative(dist, path).split('\\').join('/')
    if (name === VERSION_FILE) continue
    hash.update(`${name}\0`).update(contentOf(path)).update('\0')
  }
  return hash.digest('hex')
}

if (process.argv[1] === import.meta.filename) {
  const dist = process.argv[2] ?? 'dist'
  const hash = hashBuild(dist)
  writeFileSync(join(dist, VERSION_FILE), `${JSON.stringify({ hash })}\n`)
  console.log(hash)
}
