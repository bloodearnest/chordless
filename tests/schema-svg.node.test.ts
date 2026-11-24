/**
 * scripts/schema-svg.ts (docs/SCHEMA_RULES.md, "The diagram"): the picture of the schema, with what the
 * migrations from a number on add or change marked in orange. 0019 made `setlists` and dropped
 * `team_setlists`, which stays true of the history whatever is added after it.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const SCRIPT = new URL('../scripts/schema-svg.ts', import.meta.url).pathname
const run = (...args: string[]) =>
  spawnSync('node', ['--no-warnings', SCRIPT, ...args], { encoding: 'utf8' })

test('the migrations since a number are marked: a new table, a dropped one, a changed one', () => {
  const directory = mkdtempSync(join(tmpdir(), 'schema-'))
  try {
    const out = join(directory, 'schema.svg')
    assert.equal(run(out, '--since', '0019').status, 0)
    const svg = readFileSync(out, 'utf8')
    assert.match(svg, /setlists \(new\)/)
    assert.match(svg, /new: setlists/)
    assert.match(svg, /dropped: team_setlists/)
    assert.match(svg, /d9822b/, 'orange')
    // a table that 0019 did not touch is not marked
    assert.doesNotMatch(svg, /accounts \((new|changed)\)/)
    // a table an earlier migration changed (0003 added team_members.account_id and more)
    const older = join(directory, 'older.svg')
    assert.equal(run(older, '--since', '0003').status, 0)
    const changed = readFileSync(older, 'utf8')
    assert.match(changed, /team_members \(changed\)/)
    assert.match(changed, /changed: [^<]*team_members/)
    // a picture with nothing marked has no orange legend
    const plain = join(directory, 'plain.svg')
    assert.equal(run(plain).status, 0)
    assert.doesNotMatch(readFileSync(plain, 'utf8'), /d9822b/)
    assert.match(readFileSync(plain, 'utf8'), /team_members/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('arguments it does not understand are refused', () => {
  assert.equal(run().status, 2)
  assert.equal(run('out.svg', '--since').status, 2)
  assert.equal(run('out.svg', '--since', 'abc').status, 2)
  assert.equal(run('out.svg', '--bad', '0019').status, 2)
})
