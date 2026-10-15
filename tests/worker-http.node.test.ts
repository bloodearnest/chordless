import assert from 'node:assert/strict'
import { test } from 'node:test'
import { message } from '../worker/src/http.ts'

test('message: the text of an error, or of whatever else was thrown', () => {
  assert.equal(message(new Error('Drive said no')), 'Drive said no')
  assert.equal(message('plain string'), 'plain string')
})
