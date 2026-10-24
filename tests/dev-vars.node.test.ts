/** Writing .dev.vars from the example (scripts/dev-vars-lib.ts) */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fillTemplate, isOtherEnvironment, parseVars } from '../scripts/dev-vars-lib.ts'

test('vars are read as KEY=value lines, with quotes and comments set aside', () => {
  assert.deepEqual(parseVars('# note\nA=1\n  B = "two words"\nnot a line\nC=\n'), {
    A: '1',
    B: 'two words',
    C: '',
  })
})

test('the template keeps its comments and order, and each name gets its value', () => {
  const template = '# the id\nA=\n\n# the key\nB=old\n# no value given\nC=\nlowercase=kept\n'
  assert.equal(
    fillTemplate(template, { A: 'one', B: 'two' }),
    '# the id\nA=one\n\n# the key\nB=two\n# no value given\nC=\nlowercase=kept\n'
  )
})

test('values with = or $ in them are written as they are', () => {
  assert.equal(fillTemplate('K=\n', { K: 'a=b$&c' }), 'K=a=b$&c\n')
})

test('a file for another client is another environment’s, and so is not kept', () => {
  assert.equal(isOtherEnvironment({ GOOGLE_CLIENT_ID: 'prod' }, 'dev'), true)
  assert.equal(isOtherEnvironment({ GOOGLE_CLIENT_ID: 'dev' }, 'dev'), false)
  assert.equal(isOtherEnvironment({}, 'dev'), false)
})
