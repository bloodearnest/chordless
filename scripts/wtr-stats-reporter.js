// A Web Test Runner reporter that writes the run's counts to .stats/unit.json, for `just stats`.
// web-test-runner.config.js adds it when STATS=1 (a full run: `just test-unit` with no files).
import { mkdirSync, writeFileSync } from 'node:fs'

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

export function statsReporter(file = '.stats/unit.json') {
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
      writeFileSync(
        file,
        JSON.stringify({ ...total, seconds: Math.round((Date.now() - started) / 100) / 10 })
      )
    },
  }
}
