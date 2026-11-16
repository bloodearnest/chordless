/**
 * Which tests of Playwright's JSON report only passed on a retry (scripts/flaky-summary.ts), and when a run
 * whose only failure is a job that was never given a runner is re-run (scripts/ci/rerun-unacquired.sh)
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

// ---- scripts/ci/rerun-unacquired.sh, with a `gh` that answers from files and notes what it was asked

interface FakeJob {
  id: number
  name: string
  conclusion: string
  runner_name: string | null
  /** What the annotation of the job says (none: no annotation) */
  note?: string
}

const NOT_ACQUIRED =
  'The job was not acquired by Runner of type hosted even after multiple attempts'
const SUPERSEDED = 'Canceling since a higher priority waiting request for ci-CI-204 exists'
const macOS = (note = NOT_ACQUIRED): FakeJob => ({
  id: 7,
  name: 'End to end (macOS, WebKit)',
  conclusion: 'cancelled',
  runner_name: null,
  note,
})
const ciOk: FakeJob = {
  id: 9,
  name: 'ci-ok',
  conclusion: 'failure',
  runner_name: 'GitHub Actions 1',
}
const passed: FakeJob = {
  id: 1,
  name: 'Lint',
  conclusion: 'success',
  runner_name: 'GitHub Actions 2',
}

/** Runs the script over these jobs; says what it printed and what the fake `gh` was asked to re-run */
function rerunFor(
  jobs: FakeJob[],
  over: {
    attempt?: string
    pr?: string
    head?: string
    listFails?: boolean
    rerunFails?: boolean
  } = {}
): { out: string; reran: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'rerun-'))
  try {
    writeFileSync(join(dir, 'jobs.json'), JSON.stringify({ jobs }))
    for (const job of jobs) writeFileSync(join(dir, `note-${job.id}`), job.note ?? '')
    writeFileSync(join(dir, 'head'), over.head ?? 'abc123')
    writeFileSync(
      join(dir, 'gh'),
      `#!/usr/bin/env bash
d=${JSON.stringify(dir)}
case "$*" in
  *"/jobs"*) ${over.listFails ? 'exit 1' : 'cat "$d/jobs.json"'} ;;
  *"/annotations"*) id=$(sed -E 's#.*check-runs/([0-9]+)/annotations.*#\\1#' <<<"$*"); cat "$d/note-$id" ;;
  "pr view"*) cat "$d/head" ;;
  "run rerun"*) echo "$*" >> "$d/reran"; ${over.rerunFails ? 'exit 1' : 'exit 0'} ;;
esac
`
    )
    chmodSync(join(dir, 'gh'), 0o755)
    const ran = spawnSync('bash', ['scripts/ci/rerun-unacquired.sh'], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        GH_REPO: 'owner/repo',
        RUN_ID: '123',
        RUN_ATTEMPT: over.attempt ?? '1',
        HEAD_SHA: 'abc123',
        PR_NUMBER: over.pr ?? '',
      },
    })
    assert.equal(ran.status, 0, 'it never fails a run')
    let reran: string[] = []
    try {
      reran = readFileSync(join(dir, 'reran'), 'utf8').trim().split('\n')
    } catch {
      // (it was not asked to re-run anything)
    }
    return { out: ran.stdout, reran }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('re-runs the failed jobs of a run whose only failure is a job that was never given a runner', () => {
  const { out, reran } = rerunFor([passed, macOS(), ciOk])
  assert.deepEqual(reran, ['run rerun 123 --failed'])
  assert.match(out, /never given a runner/)
})

test('does the same for a deploy run, where the jobs are named for the workflow that called them', () => {
  const jobs = [
    { ...macOS(), name: 'CI / End to end (macOS, WebKit)' },
    { ...ciOk, name: 'CI / ci-ok' },
  ]
  assert.deepEqual(rerunFor(jobs).reran, ['run rerun 123 --failed'])
})

test('leaves a real failure alone, even when a job was never given a runner beside it', () => {
  const unit: FakeJob = {
    id: 3,
    name: 'Unit tests',
    conclusion: 'failure',
    runner_name: 'GitHub Actions 3',
  }
  const { out, reran } = rerunFor([unit, macOS(), ciOk])
  assert.deepEqual(reran, [])
  assert.match(out, /a real failure/)
})

test('leaves a job cancelled by a newer push, or by a person, alone: it had no runner either', () => {
  assert.deepEqual(rerunFor([macOS(SUPERSEDED), ciOk]).reran, [])
  assert.deepEqual(rerunFor([macOS('The run was canceled by @someone.'), ciOk]).reran, [])
  assert.deepEqual(rerunFor([macOS(''), ciOk]).reran, [], 'no annotation at all')
})

test('stops after the attempts it is allowed, and says nothing needs re-running when nothing failed', () => {
  assert.deepEqual(rerunFor([macOS(), ciOk], { attempt: '3' }).reran, [])
  assert.deepEqual(rerunFor([macOS(), ciOk], { attempt: '2' }).reran, ['run rerun 123 --failed'])
  const { out, reran } = rerunFor([passed, ciOk])
  assert.deepEqual(reran, [])
  assert.match(out, /nothing to re-run/)
})

test('does not re-run a run that is not for the newest commit of its pull request: it would cancel the newer one', () => {
  assert.deepEqual(rerunFor([macOS(), ciOk], { pr: '217', head: 'def456' }).reran, [])
  assert.deepEqual(rerunFor([macOS(), ciOk], { pr: '217', head: 'abc123' }).reran, [
    'run rerun 123 --failed',
  ])
  assert.deepEqual(
    rerunFor([macOS(), ciOk], { pr: '217', head: '' }).reran,
    [],
    'the pull request cannot be read'
  )
})

test('carries on quietly when GitHub will not list the jobs or refuses the re-run', () => {
  assert.deepEqual(rerunFor([macOS(), ciOk], { listFails: true }).reran, [])
  const { out } = rerunFor([macOS(), ciOk], { rerunFails: true })
  assert.match(out, /refused/)
})
