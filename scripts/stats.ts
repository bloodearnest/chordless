/**
 * Records how the test suites did, as one line in docs/stats.jsonl: counts, run times and
 * coverage (lines, branches, functions) for each suite, with the commit they ran on.
 *
 * `just test` runs it afterwards. The suites leave their results in .stats/ (and
 * coverage/coverage-summary.json) when they run in full, so this only reads them: run
 * `just test` to refresh them. A run on the same commit replaces the last line instead of
 * adding another, so the file has one line per commit (the latest run on it).
 *
 *   node scripts/stats.ts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'

const HISTORY = 'docs/stats.jsonl'
const MAX_AGE_MS = 60 * 60 * 1000

interface Coverage {
  lines: { covered: number; total: number }
  branches: { covered: number; total: number }
  functions: { covered: number; total: number }
  /** Files of the area the suite is meant to cover that its coverage run never loaded, so they are not in the totals */
  notMeasured?: string[]
}

interface SuiteStats {
  tests: number
  failed: number
  skipped: number
  seconds: number
  coverage?: Coverage
}

const read = (path: string) => {
  if (!existsSync(path)) {
    throw new Error(`${path} is missing: run the whole suite with \`just test\` first`)
  }
  if (Date.now() - statSync(path).mtimeMs > MAX_AGE_MS) {
    throw new Error(`${path} is more than an hour old: run \`just test\` again`)
  }
  return readFileSync(path, 'utf8')
}

const occurrences = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0

function nodeStats(): SuiteStats {
  const junit = read('.stats/node.junit.xml')
  // Node's JUnit report is a flat list of <testcase>s, with a <failure> or <skipped> inside
  const seconds = [...junit.matchAll(/<testcase[^>]* time="([\d.]+)"/g)].reduce(
    (sum, match) => sum + Number(match[1]),
    0
  )
  const total = { lines: [0, 0], branches: [0, 0], functions: [0, 0] }
  // (the report also has the src/ code the node tests run: the numbers here are of the worker)
  let inWorker = false
  for (const line of read('.stats/node.lcov').split('\n')) {
    const [key, value] = line.split(':')
    const number = Number(value)
    if (key === 'SF') inWorker = value.startsWith('worker/src/')
    else if (!inWorker) continue
    else if (key === 'LF') total.lines[1] += number
    else if (key === 'LH') total.lines[0] += number
    else if (key === 'BRF') total.branches[1] += number
    else if (key === 'BRH') total.branches[0] += number
    else if (key === 'FNF') total.functions[1] += number
    else if (key === 'FNH') total.functions[0] += number
  }
  const part = ([covered, total]: number[]) => ({ covered, total })
  // The node tests are measured on the worker (worker/src). A file they run in another process,
  // as worker/src/index.ts runs under wrangler, never shows in the report: say so
  const measured = new Set(
    read('.stats/node.lcov')
      .split('\n')
      .filter(line => line.startsWith('SF:'))
      .map(line => line.slice(3))
  )
  const notMeasured = readdirSync('worker/src')
    .filter(name => name.endsWith('.ts') && !name.endsWith('.d.ts'))
    .map(name => `worker/src/${name}`)
    .filter(file => !measured.has(file))
    // (a file of only types has nothing to run)
    .filter(file =>
      /^(export\s+)?(async\s+)?(default|function|class|const|let)\b/m.test(
        readFileSync(file, 'utf8')
      )
    )
  return {
    tests: occurrences(junit, /<testcase /g),
    failed: occurrences(junit, /<failure/g),
    skipped: occurrences(junit, /<skipped/g),
    seconds: Math.round(seconds * 10) / 10,
    coverage: {
      lines: part(total.lines),
      branches: part(total.branches),
      functions: part(total.functions),
      notMeasured,
    },
  }
}

function unitStats(): SuiteStats {
  const run = JSON.parse(read('.stats/unit.json'))
  const { total } = JSON.parse(read('coverage/coverage-summary.json'))
  const part = (x: { covered: number; total: number }) => ({ covered: x.covered, total: x.total })
  return {
    tests: run.tests,
    failed: run.failed,
    skipped: run.skipped,
    seconds: run.seconds,
    coverage: {
      lines: part(total.lines),
      branches: part(total.branches),
      functions: part(total.functions),
    },
  }
}

function e2eStats(): SuiteStats & { flaky: number } {
  const { stats } = JSON.parse(read('.stats/e2e.json'))
  return {
    tests: stats.expected + stats.unexpected + stats.flaky + stats.skipped,
    failed: stats.unexpected,
    flaky: stats.flaky,
    skipped: stats.skipped,
    seconds: Math.round(stats.duration / 100) / 10,
  }
}

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const commit = git('rev-parse', '--short', 'HEAD')
// The history file changes on every run: it does not make the tree dirty
const dirty = git('status', '--porcelain', '--', '.', `:!${HISTORY}`) !== ''

const entry = {
  date: new Date().toISOString(),
  commit,
  dirty,
  node: nodeStats(),
  unit: unitStats(),
  e2e: e2eStats(),
}

const lines = existsSync(HISTORY) ? readFileSync(HISTORY, 'utf8').split('\n').filter(Boolean) : []
if (lines.length > 0 && JSON.parse(lines[lines.length - 1]).commit === commit) lines.pop()
lines.push(JSON.stringify(entry))
writeFileSync(HISTORY, `${lines.join('\n')}\n`)

const percent = (part?: { covered: number; total: number }) =>
  part && part.total > 0 ? `${((100 * part.covered) / part.total).toFixed(1)}%` : '-'
for (const name of ['node', 'unit', 'e2e'] as const) {
  const suite = entry[name]
  const coverage = 'coverage' in suite ? suite.coverage : undefined
  console.log(
    `${name.padEnd(5)} ${String(suite.tests).padStart(4)} tests, ${suite.failed} failed, ` +
      `${suite.seconds}s` +
      (coverage ? `, lines ${percent(coverage.lines)}, branches ${percent(coverage.branches)}` : '')
  )
  if (coverage?.notMeasured?.length) {
    console.log(`      not measured: ${coverage.notMeasured.join(', ')}`)
  }
}
console.log(`recorded in ${HISTORY} (${commit}${dirty ? ', with uncommitted changes' : ''})`)
