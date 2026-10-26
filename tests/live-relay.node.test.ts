/** The live channel's rules (worker/src/live-relay.ts), apart from the sockets that carry it */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { CHANGED } from '../src/js/live-protocol.ts'
import { judge, tokenFromProtocol } from '../worker/src/live-relay.ts'

describe('tokenFromProtocol', () => {
  test('is the second of the subprotocols a page asked for, after ours', () => {
    assert.equal(tokenFromProtocol('chordless, eyJ.abc.def'), 'eyJ.abc.def')
    assert.equal(tokenFromProtocol('chordless,eyJ.abc.def'), 'eyJ.abc.def')
  })

  test('is none for anything else', () => {
    for (const header of [
      null,
      '',
      'chordless',
      'chordless, ',
      'other, eyJ.abc.def',
      'eyJ.abc.def, chordless',
      'chordless, eyJ.abc.def, more',
    ]) {
      assert.equal(tokenFromProtocol(header), null, String(header))
    }
  })
})

describe('judge', () => {
  test('relays the frame from a writer, an admin or the owner', () => {
    for (const role of ['writer', 'admin', 'owner'] as const) {
      assert.equal(judge(role, CHANGED), 'relay', role)
    }
  })

  test('closes a reader that sends anything', () => {
    assert.deepEqual(judge('reader', CHANGED), { close: 1008, reason: 'Readers only listen' })
    assert.equal((judge('reader', 'anything') as { close: number }).close, 1008)
  })

  test('closes a message that is not exactly the frame: nothing else is ever relayed', () => {
    for (const message of [
      '',
      '{"type":"changed","setlist":{}}',
      '{"type": "changed"}',
      '{"type":"other"}',
      new ArrayBuffer(8),
    ]) {
      assert.equal((judge('writer', message) as { close: number }).close, 1003)
    }
  })
})
