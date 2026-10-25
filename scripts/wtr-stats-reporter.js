// A Web Test Runner reporter that writes the run's counts to .stats/unit.json, for `just stats`,
// and how long each file's tests took to .stats/unit-files.json, which web-test-runner.config.js
// reads to start the slowest first. The config adds it when STATS=1 (a full run: `just test-unit`
// with no files).
import { mkdirSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'

const count = suite => {
  const total = { tests: 0, passed: 0, failed: 0, skipped: 0 }
  for (const test of suite.tests ?? []) {
    total.tests++
    if (test.skipped) total.skipped++
    else if (test.passed) total.passed++
    else total.failed++
  }
  for (const child of suite.suites ?? []) {
    const inner = count(child)
    for (const key of Object.keys(total)) total[key] += inner[key]
  }
  return total
}

/** How long a file's tests took, in ms (not counting the page loading) */
const duration = suite =>
  (suite?.tests ?? []).reduce((total, test) => total + (test.duration ?? 0), 0) +
  (suite?.suites ?? []).reduce((total, child) => total + duration(child), 0)

export function statsReporter(file = '.stats/unit.json', filesFile = '.stats/unit-files.json') {
  let started = 0
  return {
    start({ startTime }) {
      started = startTime
    },
    onTestRunFinished({ sessions }) {
      const total = { tests: 0, passed: 0, failed: 0, skipped: 0, files: sessions.length }
      for (const session of sessions) {
        if (!session.testResults) {
          total.failed++
          continue
        }
        const inner = count(session.testResults)
        for (const key of ['tests', 'passed', 'failed', 'skipped']) total[key] += inner[key]
      }
      mkdirSync('.stats', { recursive: true })
      const times = Object.fromEntries(
        sessions.map(session => [
          relative(process.cwd(), session.testFile),
          Math.round(duration(session.testResults)),
        ])
      )
      writeFileSync(filesFile, JSON.stringify(times, null, 1))
      writeFileSync(
        file,
        JSON.stringify({ ...total, seconds: Math.round((Date.now() - started) / 100) / 10 })
      )
    },
  }
}
