/** Which tests of Playwright's JSON report only passed on a retry (scripts/flaky-summary.ts) */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { flakyTests, summary } from '../scripts/flaky-summary.ts'

const spec = (title: string, status: string, runs: number) => ({
  title,
  file: 'tests/live.playwright.ts',
  line: 12,
  tests: [
    {
      projectName: 'webkit',
      status,
      results: Array.from({ length: runs }, (_, retry) => ({
        retry,
        status: retry === runs - 1 ? 'passed' : 'failed',
      })),
    },
  ],
})

const report = {
  suites: [
    {
      title: 'tests/live.playwright.ts',
      specs: [spec('opens', 'expected', 1)],
      suites: [
        {
          title: 'Editing a setlist',
          specs: [spec('drags a song', 'flaky', 3), spec('adds a note', 'expected', 1)],
        },
      ],
    },
  ],
}

test('only a test that passed on a retry is listed, with its describe blocks, run and place', () => {
  assert.deepEqual(flakyTests(report), [
    {
      title: 'Editing a setlist › drags a song',
      project: 'webkit',
      where: 'tests/live.playwright.ts:12',
      attempts: 3,
    },
  ])
})

test('a failed test is not flaky, and no flaky test says so', () => {
  assert.deepEqual(
    flakyTests({ suites: [{ title: 'f', specs: [spec('breaks', 'unexpected', 3)] }] }),
    []
  )
  assert.equal(summary([]), 'No test needed a retry.\n')
})

test('the summary names each flaky test', () => {
  const text = summary(flakyTests(report))
  assert.match(text, /### 1 flaky test \(passed on a retry\)/)
  assert.match(
    text,
    /- Editing a setlist › drags a song \(webkit, tests\/live\.playwright\.ts:12\): passed on run 3/
  )
})
