/**
 * scripts/plan-noise.jq: whether a Terraform plan (`terraform show -json`) changes nothing of ours. The
 * provider plans the D1 database's size, tables and version as "known after apply" on every run, which
 * made every deploy wait for an apply that changed nothing. Anything else must stay a change.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const FILTER = new URL('../scripts/plan-noise.jq', import.meta.url).pathname

/** Whether the filter calls the plan noise (jq -e: exit 0 when true) */
function isNoise(plan: unknown): boolean {
  const run = spawnSync('jq', ['-e', '-f', FILTER], {
    input: typeof plan === 'string' ? plan : JSON.stringify(plan),
  })
  return run.status === 0
}

const d1 = {
  address: 'cloudflare_d1_database.teams',
  change: {
    actions: ['update'],
    before: {
      id: 'x',
      name: 'chordless-teams',
      file_size: 344064,
      num_tables: 24,
      version: 'production',
    },
    after: { id: 'x', name: 'chordless-teams' },
    after_unknown: { file_size: true, num_tables: true, version: true },
  },
}
const plan = (...changes: unknown[]) => ({ resource_changes: changes })
const withChange = (over: Record<string, unknown>) => ({
  ...d1,
  change: { ...d1.change, ...over },
})

test('values the provider reports of its own are not a change', () => {
  assert.equal(isNoise(plan(d1)), true)
  assert.equal(isNoise({}), true, 'a plan with nothing in it')
  assert.equal(isNoise(plan({ address: 'a', change: { actions: ['no-op'] } }, d1)), true)
  assert.equal(isNoise(plan({ address: 'a', change: { actions: ['read'] } })), true)
})

test('any change of ours is a change', () => {
  // a value we set, changed
  assert.equal(isNoise(plan(withChange({ after: { id: 'x', name: 'renamed' } }))), false)
  // a value Terraform knows, removed in the configuration
  assert.equal(isNoise(plan(withChange({ after: { id: 'x', name: null } }))), false)
  for (const actions of [
    ['create'],
    ['delete'],
    ['delete', 'create'],
    ['create', 'delete'],
    ['forget'],
  ])
    assert.equal(isNoise(plan(withChange({ actions }))), false, actions.join(' '))
  // beside one that is not
  assert.equal(
    isNoise(plan(d1, { address: 'b', change: { actions: ['create'], before: null, after: {} } })),
    false
  )
})

test('an import, a move and a changed output are changes though nothing else is', () => {
  assert.equal(isNoise(plan(withChange({ importing: { id: 'x' }, actions: ['no-op'] }))), false)
  assert.equal(isNoise(plan({ ...d1, previous_address: 'cloudflare_d1_database.old' })), false)
  assert.equal(isNoise({ ...plan(d1), output_changes: { x: { actions: ['create'] } } }), false)
  assert.equal(isNoise({ ...plan(d1), output_changes: { x: { actions: ['no-op'] } } }), true)
})

test('what cannot be read is a change', () => {
  assert.equal(isNoise(''), false)
  assert.equal(isNoise('not json'), false)
})

/** The D1 database's change in the plan of the deploy of 2026-11-23 (`terraform show -json`, provider 5.29.0), as it was */
const REAL = JSON.parse(
  readFileSync(new URL('./fixtures/terraform-plan-d1.json', import.meta.url), 'utf8')
)

test('the real plan of the D1 database, as the provider made it, is not a change', () => {
  assert.equal(REAL.resource_changes[0].change.actions[0], 'update')
  assert.equal(isNoise(REAL), true)
})

test('the same real plan with a value of ours changed is a change', () => {
  const renamed = structuredClone(REAL)
  renamed.resource_changes[0].change.after.name = 'chordless-teams-2'
  assert.equal(isNoise(renamed), false)
  const moved = structuredClone(REAL)
  moved.resource_changes[0].change.after.read_replication = { mode: 'auto' }
  assert.equal(isNoise(moved), false)
})
