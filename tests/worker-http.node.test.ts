import assert from 'node:assert/strict'
import { test } from 'node:test'
import { message } from '../worker/src/http.ts'

test('message: the text of an error, or of whatever else was thrown', () => {
  assert.equal(message(new Error('Drive said no')), 'Drive said no')
  assert.equal(message('plain string'), 'plain string')
})

test("message: an OAuth error from Google says which, with Google's description when it has one", () => {
  const refused = (fields: object) => Object.assign(new Error('server said no'), fields)
  assert.equal(
    message(refused({ error: 'invalid_client', error_description: 'Unauthorized' })),
    'server said no: invalid_client (Unauthorized)'
  )
  assert.equal(
    message(refused({ error: 'redirect_uri_mismatch' })),
    'server said no: redirect_uri_mismatch'
  )
})
