// Before a deploy: the production Worker has every secret it needs (worker/src/config.ts), by name.
// `wrangler secret list` shows names, never values.
import { execFileSync } from 'node:child_process'
import { SECRETS } from '../worker/src/config.ts'

const listed = JSON.parse(
  execFileSync('npx', ['wrangler', 'secret', 'list', '--format', 'json', '--env', ''], {
    encoding: 'utf8',
  })
) as { name: string }[]
const set = new Set(listed.map(secret => secret.name))

const missing = SECRETS.filter(secret => secret.required && !set.has(secret.name))
for (const secret of SECRETS.filter(secret => !secret.required && !set.has(secret.name))) {
  console.log(`not set (optional): ${secret.name}: ${secret.about}`)
}
if (missing.length > 0) {
  console.error(`The production Worker lacks: ${missing.map(secret => secret.name).join(', ')}`)
  console.error('Set each with: npx wrangler secret put NAME (docs/ENVIRONMENTS.md)')
  process.exit(1)
}
console.log('The production Worker has all the secrets it needs.')
