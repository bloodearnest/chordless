// What in a D1 database would make migrations/0011_schema_cleanup.sql stop (docs/SCHEMA_AUDIT.md, section 6).
// Runs scripts/schema-preflight.sql one statement at a time and prints what each answers: wrangler's remote
// `--file` is an import, which does not give a SELECT's rows back, so the file cannot just be handed to it.
// Read-only: the file holds nothing but SELECTs.
//
//   node scripts/schema-preflight.ts                          the production database (chordless-teams, --remote)
//   node scripts/schema-preflight.ts <database> [wrangler flags]
//   node scripts/schema-preflight.ts DB --local --persist-to <dir>        a local one, to try it
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const [database = 'chordless-teams', ...flags] = process.argv.slice(2)
const where = flags.length > 0 ? flags : ['--remote']

/** The statements of the file: it has no `;` inside a string, and each ends at one (comments are dropped first) */
const statements = readFileSync(new URL('./schema-preflight.sql', import.meta.url), 'utf8')
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map(statement => statement.trim())
  .filter(Boolean)

interface Row {
  what: string
  n: number
  wanted: string
}

const rows: Row[] = []
for (const statement of statements) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', database, ...where, '--json', '--command', statement],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  )
  // (wrangler may print a notice before the JSON)
  const answers = JSON.parse(out.slice(out.indexOf('['))) as { results: Row[] }[]
  for (const answer of answers) rows.push(...answer.results)
}

// What stops the migration first, then the rest, then what is only to look at
rows.sort(
  (a, b) =>
    Number(a.wanted === 'info') - Number(b.wanted === 'info') ||
    Number(a.n === 0) - Number(b.n === 0) ||
    a.what.localeCompare(b.what)
)
for (const { what, n, wanted } of rows) {
  const stops = wanted !== 'info' && n !== 0
  console.log(
    `${stops ? '!!' : '  '} ${String(n).padStart(5)}  ${wanted === 'info' ? 'info' : '   0'}  ${what}`
  )
}
const stops = rows.filter(row => row.wanted !== 'info' && row.n !== 0)
console.log(
  stops.length === 0
    ? '\nNothing here would stop 0011.'
    : `\n${stops.length} thing${stops.length === 1 ? '' : 's'} to put right or decide about before 0011 (the lines marked !!).`
)
process.exitCode = stops.length === 0 ? 0 : 1
