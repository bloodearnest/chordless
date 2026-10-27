// The tests that only passed on a retry, from Playwright's JSON report, for a CI job's summary:
// `retries: 2` in CI (playwright.config.ts) keeps one flaky test from failing a run, and would also
// hide it. Each is worth a line in docs/test-catches.jsonl (kind `flaky`) and a look.
// Usage: node scripts/flaky-summary.ts [test-results/results.json]
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

interface Suite {
  title: string
  suites?: Suite[]
  specs?: { title: string; file: string; line: number; tests: Test[] }[]
}
interface Test {
  projectName: string
  status: string // expected, unexpected, flaky or skipped
  results: { retry: number; status: string }[]
}

export interface Flaky {
  title: string
  project: string
  where: string
  attempts: number
}

/** Every test that passed on a retry: its describe blocks and title, project, file and line, and how many runs it took */
export const flakyTests = (report: { suites?: Suite[] }): Flaky[] => {
  const found: Flaky[] = []
  const walk = (suite: Suite, path: string[]) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        if (test.status !== 'flaky') continue
        found.push({
          title: [...path, spec.title].join(' › '),
          project: test.projectName,
          where: `${spec.file}:${spec.line}`,
          attempts: test.results.length,
        })
      }
    }
    // (the top level is the file: its name is in `where`)
    for (const child of suite.suites ?? []) walk(child, [...path, child.title])
  }
  for (const file of report.suites ?? []) walk(file, [])
  return found
}

export const summary = (flaky: Flaky[]): string =>
  flaky.length === 0
    ? 'No test needed a retry.\n'
    : [
        `### ${flaky.length} flaky test${flaky.length === 1 ? '' : 's'} (passed on a retry)`,
        '',
        ...flaky.map(
          test => `- ${test.title} (${test.project}, ${test.where}): passed on run ${test.attempts}`
        ),
        '',
      ].join('\n')

if (process.argv[1] === import.meta.filename) {
  const path = process.argv[2] ?? 'test-results/results.json'
  if (!existsSync(path)) {
    console.log(`No report at ${path}`)
    process.exit(0)
  }
  const text = summary(flakyTests(JSON.parse(readFileSync(path, 'utf8'))))
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
}
