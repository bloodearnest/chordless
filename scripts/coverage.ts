/**
 * The coverage of the app's code by all the tests that measure it, together: the node tests
 * (.stats/node.lcov) and the browser unit tests (coverage/lcov.info). `just coverage` runs both
 * and then this.
 *
 *   node scripts/coverage.ts                 a summary, and the files with the most missing
 *   node scripts/coverage.ts --all           every file with something missing
 *   node scripts/coverage.ts src/js/db.ts    the lines and branches of one file that no test reaches
 *   node scripts/coverage.ts --lower         record better coverage as the new floor
 *   node scripts/coverage.ts --accept        record the files that went down too: when that is wanted,
 *                                            such as a change that adds code the tests do not reach yet
 *
 * What it adds to the two reports:
 * - A line is covered if either suite ran it. Branches are merged by the line they are on, taking
 *   the better of the two; for functions, the report of a file that ran more of them is used.
 * - Source files that neither suite loaded are listed as unloaded, since they are not in either
 *   report at all.
 * - Code marked as not worth covering is left out of every count. The marks are comments, each with
 *   a reason after `--`, which this checks for:
 *       /* v8 ignore next -- why *\/            this line     (`next 3`: this and the next 2)
 *       /* v8 ignore start -- why *\/ ... /* v8 ignore stop *\/
 *   `node:coverage` and `c8` are read as `v8`, and `disable`/`enable` as `start`/`stop`.
 * - It fails when a file has more missing than `docs/coverage-floor.json` allows, and says when a
 *   file has less, so the floor can be lowered (`--lower`): coverage can only go up, until the
 *   floor is empty (100%). The floor is not lowered by itself, as a few lines of a few files come
 *   and go with timing from run to run: lower it from a run or two that agree.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FLOOR = 'docs/coverage-floor.json'
const REPORTS = ['.stats/node.lcov', 'coverage/lcov.info']
const SOURCE_DIRS = ['src', 'worker/src']

type Count = { total: number; hit: number }

interface FileCoverage {
  /** line -> hits */
  lines: Map<number, number>
  /** line -> branches there and how many were taken */
  branches: Map<number, Count>
  /** "name@line" -> hits */
  functions: Map<string, number>
}

const emptyFile = (): FileCoverage => ({
  lines: new Map(),
  branches: new Map(),
  functions: new Map(),
})

function parseLcov(path: string, into: Map<string, FileCoverage>) {
  let file: FileCoverage | undefined
  // The lines of the functions of each name, in the order they were declared: the hits that
  // follow name them again, in the same order, and more than one function can have a name
  const declared = new Map<string, number[]>()
  const answered = new Map<string, number>()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const colon = line.indexOf(':')
    const key = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? '' : line.slice(colon + 1)
    if (key === 'SF') {
      file = emptyFile()
      declared.clear()
      answered.clear()
      into.set(value, file)
    } else if (file && key === 'FN') {
      const [at, name] = value.split(',')
      declared.set(name, [...(declared.get(name) ?? []), Number(at)])
      file.functions.set(`${name}@${at}`, file.functions.get(`${name}@${at}`) ?? 0)
    } else if (file && key === 'FNDA') {
      const [hits, name] = value.split(',')
      const nth = answered.get(name) ?? 0
      answered.set(name, nth + 1)
      const id = `${name}@${declared.get(name)?.[nth]}`
      file.functions.set(id, Math.max(file.functions.get(id) ?? 0, Number(hits)))
    } else if (file && key === 'DA') {
      const [at, hits] = value.split(',').map(Number)
      file.lines.set(at, Math.max(file.lines.get(at) ?? 0, hits))
    } else if (file && key === 'BRDA') {
      const [at, , , taken] = value.split(',')
      const count = file.branches.get(Number(at)) ?? { total: 0, hit: 0 }
      count.total++
      if (taken !== '-' && Number(taken) > 0) count.hit++
      file.branches.set(Number(at), count)
    }
  }
}

// (each report is read on its own; the reports are merged after)
function readReport(path: string) {
  const files = new Map<string, FileCoverage>()
  if (existsSync(path)) parseLcov(path, files)
  return files
}

function mergeReports(reports: Map<string, FileCoverage>[]) {
  const merged = new Map<string, FileCoverage>()
  for (const report of reports) {
    for (const [name, file] of report) {
      const into = merged.get(name)
      if (!into) {
        merged.set(name, file)
        continue
      }
      for (const [line, hits] of file.lines) {
        into.lines.set(line, Math.max(into.lines.get(line) ?? 0, hits))
      }
      // V8 lists a block that did not run, so a line that ran with no branch listed has all of
      // its branches taken: the other report's branch there is not to count against it (as Node's
      // for a class declaration)
      const alone = (_from: FileCoverage, other: FileCoverage, line: number) =>
        !other.branches.has(line) && (other.lines.get(line) ?? 0) > 0
      for (const line of [...into.branches.keys()]) {
        if (alone(into, file, line) && !file.branches.has(line)) into.branches.delete(line)
      }
      for (const [line, count] of file.branches) {
        const have = into.branches.get(line)
        if (have) {
          have.total = Math.max(have.total, count.total)
          have.hit = Math.max(have.hit, count.hit)
        } else if (!alone(file, into, line)) into.branches.set(line, count)
      }
      // Functions are named and placed differently by Node and by V8, so two reports of one file
      // cannot be added up: the one that ran more of them is taken
      const ran = (functions: Map<string, number>) =>
        [...functions.values()].filter(hits => hits > 0).length
      if (ran(file.functions) > ran(into.functions)) into.functions = file.functions
    }
  }
  return merged
}

/**
 * V8 reports the field initialisers of a class (`static readonly type = ...`, `#timer = ...`) as
 * functions, and the ones it never calls are reported as not run when the class has run them
 * every time: they are not code of the app's to cover
 */
const FIELD_INITIALISER = /^<(static|instance_members)_initializer>@/

const IGNORE =
  /\/\*\s*(?:v8|c8|node:coverage)\s+(?:ignore\s+)?(next|start|stop|disable|enable)\b([^*]*)\*\//

interface Ignores {
  /** the lines to leave out */
  lines: Set<number>
  /** the marks with no reason after `--` */
  unexplained: number[]
  marks: number
}

function ignoresIn(source: string): Ignores {
  const result: Ignores = { lines: new Set(), unexplained: [], marks: 0 }
  let ignoring = false
  let following = 0
  source.split('\n').forEach((text, index) => {
    const line = index + 1
    const mark = text.match(IGNORE)
    if (following > 0) {
      result.lines.add(line)
      following--
    }
    if (!mark) {
      if (ignoring) result.lines.add(line)
      return
    }
    const [, what, rest] = mark
    result.marks++
    result.lines.add(line)
    if (what !== 'stop' && what !== 'enable' && !/--\s*\S/.test(rest)) {
      result.unexplained.push(line)
    }
    if (what === 'next') {
      const count = Number(rest.trim().match(/^\d+/)?.[0] ?? 1)
      // On a line of its own the mark covers the lines after it; after code, that line and the rest
      following = text.trim().startsWith('/*') ? count : count - 1
    } else {
      ignoring = what === 'start' || what === 'disable'
    }
  })
  return result
}

/** The source files that can be covered: not types only, not the dev pages */
function sourceFiles() {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (path !== 'src/dev') walk(path)
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) found.push(path)
    }
  }
  for (const dir of SOURCE_DIRS) walk(dir)
  return found.sort()
}

/** A file of only types has nothing to run */
const hasCode = (source: string) =>
  /^(export\s+)?(async\s+)?(default|function|class|const|let)\b/m.test(source)

/** Roughly the lines of code in a file no test loaded: not blank, not a comment, not a lone brace */
function codeLines(source: string, ignored: Set<number>) {
  let inComment = false
  let count = 0
  source.split('\n').forEach((text, index) => {
    const line = text.trim()
    if (inComment) {
      if (line.includes('*/')) inComment = false
      return
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inComment = true
      return
    }
    if (!line || line.startsWith('//') || /^[)}\]{(,;]+$/.test(line)) return
    if (!ignored.has(index + 1)) count++
  })
  return count
}

interface Missing {
  lines: number
  branches: number
  functions: number
  /** for a file no test loaded: its lines of code (and nothing else is known) */
  unloaded?: number
}

const ranges = (numbers: number[]) => {
  const out: string[] = []
  for (let i = 0; i < numbers.length; i++) {
    let j = i
    while (numbers[j + 1] === numbers[j] + 1) j++
    out.push(j > i ? `${numbers[i]}-${numbers[j]}` : `${numbers[i]}`)
    i = j
  }
  return out.join(', ')
}

const args = process.argv.slice(2)
const showAll = args.includes('--all')
const lower = args.includes('--lower')
const accept = args.includes('--accept')
const only = args.find(arg => !arg.startsWith('--'))

for (const path of REPORTS) {
  if (!existsSync(path)) {
    console.error(`${path} is missing: run \`just coverage\` (or \`just test\`) first`)
    process.exit(1)
  }
}
const merged = mergeReports(REPORTS.map(readReport))

const totals = { lines: [0, 0], branches: [0, 0], functions: [0, 0] }
const missing = new Map<string, Missing>()
const detail = new Map<string, { lines: number[]; branches: number[]; functions: string[] }>()
const unexplained: string[] = []
let marks = 0

for (const file of sourceFiles()) {
  const source = readFileSync(file, 'utf8')
  const ignores = ignoresIn(source)
  marks += ignores.marks
  for (const line of ignores.unexplained) unexplained.push(`${file}:${line}`)
  const coverage = merged.get(file)
  if (!coverage) {
    if (hasCode(source)) {
      missing.set(file, {
        lines: 0,
        branches: 0,
        functions: 0,
        unloaded: codeLines(source, ignores.lines),
      })
    }
    continue
  }
  const kept = (line: number) => !ignores.lines.has(line)
  const missed = {
    lines: [...coverage.lines].filter(([line, hits]) => kept(line) && hits === 0).map(([l]) => l),
    branches: [...coverage.branches]
      .filter(([line, count]) => kept(line) && count.hit < count.total)
      .map(([l]) => l),
    functions: [...coverage.functions]
      .filter(
        ([id, hits]) => kept(Number(id.split('@')[1])) && hits === 0 && !FIELD_INITIALISER.test(id)
      )
      .map(([id]) => id),
  }
  for (const [line] of coverage.lines) if (kept(line)) totals.lines[1]++
  totals.lines[0] += [...coverage.lines].filter(([l, h]) => kept(l) && h > 0).length
  for (const [line, count] of coverage.branches) {
    if (!kept(line)) continue
    totals.branches[1] += count.total
    totals.branches[0] += count.hit
  }
  for (const [id, hits] of coverage.functions) {
    if (!kept(Number(id.split('@')[1])) || FIELD_INITIALISER.test(id)) continue
    totals.functions[1]++
    if (hits > 0) totals.functions[0]++
  }
  const branchesMissing = [...coverage.branches]
    .filter(([line]) => kept(line))
    .reduce((sum, [, count]) => sum + count.total - count.hit, 0)
  if (missed.lines.length || branchesMissing || missed.functions.length) {
    missing.set(file, {
      lines: missed.lines.length,
      branches: branchesMissing,
      functions: missed.functions.length,
    })
    detail.set(file, missed)
  }
}

if (only) {
  const found = detail.get(only)
  if (!found) {
    console.log(missing.has(only) ? `${only}: no test loads it` : `${only}: nothing missing`)
  } else {
    console.log(`${only}`)
    console.log(`  lines not run:      ${ranges(found.lines.sort((a, b) => a - b))}`)
    console.log(
      `  branches not taken: ${ranges([...new Set(found.branches)].sort((a, b) => a - b))}`
    )
    console.log(
      `  functions not run:  ${found.functions.map(id => id.replace('@', ' line ')).join(', ')}`
    )
  }
  process.exit(0)
}

const percent = ([hit, total]: number[]) => `${((100 * hit) / total).toFixed(1)}%`
const unloaded = [...missing].filter(([, m]) => m.unloaded !== undefined)
const gaps = [...missing].filter(([, m]) => m.unloaded === undefined)
const weight = (m: Missing) => m.lines + m.branches + m.functions
gaps.sort(([, a], [, b]) => weight(b) - weight(a))

console.log(
  `lines ${percent(totals.lines)} (${totals.lines[1] - totals.lines[0]} not run), ` +
    `branches ${percent(totals.branches)} (${totals.branches[1] - totals.branches[0]} not taken), ` +
    `functions ${percent(totals.functions)} (${totals.functions[1] - totals.functions[0]} not run)`
)
console.log(
  `${gaps.length} files with something missing; ${unloaded.length} files no test loads ` +
    `(${unloaded.reduce((sum, [, m]) => sum + (m.unloaded ?? 0), 0)} lines of code); ` +
    `${marks} ignore marks`
)
for (const [file, m] of showAll ? gaps : gaps.slice(0, 25)) {
  console.log(
    `  ${file.padEnd(48)} lines ${String(m.lines).padStart(5)}  branches ${String(m.branches).padStart(4)}  functions ${String(m.functions).padStart(3)}`
  )
}
if (!showAll && gaps.length > 25) console.log(`  ... and ${gaps.length - 25} more (--all)`)
for (const [file, m] of unloaded) console.log(`  not loaded: ${file} (${m.unloaded} lines)`)

// The floor: no file may have more missing than recorded; less lowers it
const starting = !existsSync(FLOOR)
const floor: Record<string, Missing> = starting
  ? Object.fromEntries(missing)
  : JSON.parse(readFileSync(FLOOR, 'utf8'))
const problems: string[] = []
const next: Record<string, Missing> = {}
for (const file of [...new Set([...Object.keys(floor), ...missing.keys()])].sort()) {
  const now = missing.get(file)
  const was = floor[file]
  if (!now) continue // fully covered now: drops off the floor
  if (!was) {
    problems.push(`${file}: new gap (${JSON.stringify(now)}); cover it or mark it with a reason`)
    next[file] = now
    continue
  }
  const worse = (['lines', 'branches', 'functions', 'unloaded'] as const).filter(
    key => (now[key] ?? 0) > (was[key] ?? 0)
  )
  if (worse.length) {
    problems.push(
      `${file}: ${worse.map(key => `${key} ${was[key] ?? 0} -> ${now[key]}`).join(', ')}`
    )
    next[file] = accept ? now : was
  } else {
    next[file] = {
      lines: Math.min(now.lines, was.lines),
      branches: Math.min(now.branches, was.branches),
      functions: Math.min(now.functions, was.functions),
      ...(now.unloaded === undefined
        ? {}
        : { unloaded: Math.min(now.unloaded, was.unloaded ?? now.unloaded) }),
    }
  }
}
if (unexplained.length) {
  problems.push(`ignore marks with no reason (add \`-- why\`): ${unexplained.join(', ')}`)
}

const better = JSON.stringify(next) !== JSON.stringify(floor)
if ((starting || ((lower || accept) && better)) && (accept || problems.length === 0)) {
  writeFileSync(FLOOR, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`${FLOOR} ${starting ? 'created' : 'lowered'}: commit it`)
} else if (better && problems.length === 0) {
  console.log(`Better than ${FLOOR}: node scripts/coverage.ts --lower records it`)
}
if (problems.length && accept) {
  console.log('\nAccepted as the floor, though lower:')
  for (const problem of problems) console.log(`  ${problem}`)
} else if (problems.length) {
  console.error('\nCoverage went down:')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
