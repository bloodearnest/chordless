/**
 * Which tests of Playwright's JSON report only passed on a retry (scripts/flaky-summary.ts), and when a run
 * whose only failure is a job that was never given a runner, or that the watchdog cancelled for waiting for
 * one, is re-run (scripts/ci/rerun-unacquired.sh), and when that watchdog cancels (scripts/ci/watch-unacquired.sh)
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

test('re-runs a run that the watchdog cancelled, which is a job with no runner and the watchdog itself, but not one a person cancelled', () => {
  const byTheRunsToken = 'The run was canceled by @github-actions[bot].'
  const watchdog: FakeJob = {
    id: 5,
    name: 'Watch for a runner',
    conclusion: 'cancelled',
    runner_name: 'GitHub Actions 5',
    note: byTheRunsToken,
  }
  assert.deepEqual(rerunFor([passed, macOS(byTheRunsToken), watchdog, ciOk]).reran, [
    'run rerun 123 --failed',
  ])
  // (the watchdog cancels only when nothing else is running: a job that was running, cancelled by a person, is not its)
  const person: FakeJob = {
    ...watchdog,
    name: 'Unit tests',
    note: 'The run was canceled by @someone.',
  }
  assert.deepEqual(rerunFor([macOS(byTheRunsToken), person, ciOk]).reran, [])
  // (and a failure beside it is still a failure)
  const failing: FakeJob = {
    id: 3,
    name: 'Unit tests',
    conclusion: 'failure',
    runner_name: 'GitHub Actions 3',
  }
  assert.deepEqual(rerunFor([macOS(byTheRunsToken), watchdog, failing, ciOk]).reran, [])
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

// ---- scripts/ci/watch-unacquired.sh: the jobs as they were listed, one listing for each time it asks

interface RunJob {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion?: string | null
  runner_name?: string | null
  /** Minutes since it was queued */
  queued?: number
}

const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString().replace(/\.\d+Z$/, 'Z')
const done = (name: string, conclusion = 'success'): RunJob => ({
  name,
  status: 'completed',
  conclusion,
  runner_name: 'GitHub Actions 1',
})
const running = (name: string): RunJob => ({
  name,
  status: 'in_progress',
  runner_name: 'GitHub Actions 2',
})
const waiting = (name: string, minutes: number): RunJob => ({
  name,
  status: 'queued',
  runner_name: null,
  queued: minutes,
})
const watching = (prefix = ''): RunJob => running(`${prefix}Watch for a runner`)

/** Runs the watchdog over these listings (the last one for every ask after); what it printed, how often it asked, and whether it cancelled */
function watchFor(
  listings: RunJob[][],
  over: { attempt?: string; stable?: string; limit?: string; listFails?: boolean } = {}
): { out: string; asked: number; cancelled: boolean } {
  const dir = mkdtempSync(join(tmpdir(), 'watch-'))
  try {
    listings.forEach((listing, index) => {
      const jobs = listing.map((job, id) => ({
        id: id + 1,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion ?? null,
        runner_name: job.runner_name ?? null,
        created_at: ago(job.queued ?? 10),
      }))
      writeFileSync(join(dir, `jobs-${index}.json`), JSON.stringify({ jobs }))
    })
    writeFileSync(join(dir, 'count'), '0')
    writeFileSync(
      join(dir, 'gh'),
      `#!/usr/bin/env bash
d=${JSON.stringify(dir)}
case "$*" in
  *"/jobs"*)
    ${over.listFails ? 'exit 1' : ''}
    n=$(cat "$d/count"); echo $((n + 1)) > "$d/count"
    last=${listings.length - 1}
    cat "$d/jobs-$((n > last ? last : n)).json" ;;
  "run cancel"*) echo "$*" >> "$d/cancelled" ;;
esac
`
    )
    chmodSync(join(dir, 'gh'), 0o755)
    const ran = spawnSync('bash', ['scripts/ci/watch-unacquired.sh'], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        GH_REPO: 'owner/repo',
        RUN_ID: '123',
        RUN_ATTEMPT: over.attempt ?? '1',
        POLL_SECONDS: '0',
        STABLE_SECONDS: over.stable ?? '0',
        CANCEL_GRACE_SECONDS: '0',
        MIN_WAIT_SECONDS: '180',
        MAX_SECONDS: over.limit ?? '30',
      },
    })
    assert.equal(ran.status, 0, 'it never fails a run')
    let cancelled = false
    try {
      cancelled = readFileSync(join(dir, 'cancelled'), 'utf8').includes('run cancel 123')
    } catch {
      // (it did not cancel)
    }
    return { out: ran.stdout, asked: Number(readFileSync(join(dir, 'count'), 'utf8')), cancelled }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const MAC = 'End to end (macOS, WebKit)'
const everyoneElseDone = [
  done('Changes'),
  done('Lint'),
  done('Unit tests'),
  done('End to end (Windows, Edge)'),
  done('End to end (Linux, Chromium)'),
]

test('cancels the run when nothing else is running and a job has waited for a runner for minutes', () => {
  const { out, cancelled } = watchFor([[...everyoneElseDone, waiting(MAC, 5), watching()]])
  assert.equal(cancelled, true)
  assert.match(out, /no runner was given to: End to end \(macOS, WebKit\)/)
})

test('waits while another job is running, and cancels once it is done and the job still has no runner', () => {
  const windows = 'End to end (Windows, Edge)'
  const others = everyoneElseDone.filter(job => job.name !== windows)
  const { cancelled, asked } = watchFor([
    [...others, running(windows), waiting(MAC, 5), watching()],
    [...others, running(windows), waiting(MAC, 5), watching()],
    [...others, done(windows), waiting(MAC, 5), watching()],
  ])
  assert.equal(cancelled, true)
  assert.equal(asked, 3, 'not at the first two')
})

test('does not cancel when the job gets its runner after all, or has waited less than three minutes', () => {
  assert.equal(watchFor([[...everyoneElseDone, running(MAC), watching()]]).cancelled, false)
  const { cancelled, asked } = watchFor([[...everyoneElseDone, waiting(MAC, 1), watching()]], {
    // (a few seconds, so that a slow start of the script under load does not use the time up on the first look)
    limit: '4',
  })
  assert.equal(cancelled, false)
  assert.ok(asked > 1, 'it kept watching until its time was up')
  // (it was waiting, and then got a runner)
  assert.equal(
    watchFor(
      [
        [...everyoneElseDone, waiting(MAC, 5), watching()],
        [...everyoneElseDone, running(MAC), watching()],
      ],
      { stable: '100' }
    ).cancelled,
    false
  )
})

test('does not cancel when a job has failed: a re-run would not help, and the run fails either way', () => {
  const { out, cancelled } = watchFor([
    [done('Changes'), done('Unit tests', 'failure'), waiting(MAC, 5), watching()],
  ])
  assert.equal(cancelled, false)
  assert.match(out, /A job failed/)
})

test('wants the state to hold for a while: a job that is only waiting for the last to finish is not stuck', () => {
  const { cancelled } = watchFor(
    [
      [...everyoneElseDone, waiting(MAC, 5), watching()],
      [
        ...everyoneElseDone.slice(0, 3),
        running('End to end (Windows, Edge)'),
        waiting(MAC, 5),
        watching(),
      ],
      [...everyoneElseDone, running(MAC), watching()],
    ],
    { stable: '100' }
  )
  assert.equal(cancelled, false)
})

test('looks only at the run’s own jobs in a deploy run, where they are named for the workflow that called them', () => {
  const ci = (job: RunJob): RunJob => ({ ...job, name: `CI / ${job.name}` })
  const listing = [
    ...everyoneElseDone.map(ci),
    ci(waiting(MAC, 5)),
    ci(watching()),
    // (the deploy's own jobs wait for CI, and ci-ok waits for everything: neither is the one waiting for a runner)
    waiting('Deploy', 8),
    waiting('CI / ci-ok', 8),
    done('Infrastructure plan'),
  ]
  const { out, cancelled } = watchFor([listing])
  assert.equal(cancelled, true)
  assert.match(out, /no runner was given to: CI \/ End to end \(macOS, WebKit\)\. /)
})

test('does nothing in the last attempt, or when GitHub will not list the jobs', () => {
  assert.equal(
    watchFor([[...everyoneElseDone, waiting(MAC, 5), watching()]], { attempt: '3' }).asked,
    0
  )
  const { cancelled, out } = watchFor([[...everyoneElseDone, waiting(MAC, 5)]], { listFails: true })
  assert.equal(cancelled, false)
  assert.match(out, /not watching/)
})
