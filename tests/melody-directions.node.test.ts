/** Reading a direction's text (src/js/melody-directions.ts) */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseDirection } from '../src/js/melody-directions.ts'

describe('jump directions', () => {
  it('reads D.S. and D.C. with the place they go to, a segno and a coda from their signs', () => {
    const d = (text: string) => parseDirection(text)
    assert.deepEqual(d('D.S. al Coda'), {
      kind: 'da-segno',
      al: 'coda',
      time: null,
      text: 'D.S. al Coda',
    })
    assert.deepEqual(d('D.C. al Fine'), {
      kind: 'da-capo',
      al: 'fine',
      time: null,
      text: 'D.C. al Fine',
    })
    assert.equal(d('D.S.')?.al, null)
    assert.equal(d('Fine')?.kind, 'fine')
    assert.equal(d('\ue047')?.kind, 'segno')
    assert.equal(d('\ue048')?.kind, 'coda')
    assert.equal(d('Coda')?.kind, 'coda')
    assert.equal(d('Segno')?.kind, 'segno')
  })

  it('reads "2nd time to Coda" with its pass, and keeps plain instructions as text', () => {
    assert.deepEqual(parseDirection('2nd time to Coda\ue048'), {
      kind: 'to-coda',
      al: null,
      time: 2,
      text: '2nd time to Coda',
    })
    // (the last of three is the third)
    assert.deepEqual(parseDirection('Repeat 3x Last time to Coda'), {
      kind: 'to-coda',
      al: null,
      time: 3,
      text: 'Repeat 3x Last time to Coda',
    })
    assert.equal(parseDirection('Last time to Coda')?.time, null)
    assert.deepEqual(parseDirection('Play 3 times'), {
      kind: 'text',
      al: null,
      time: null,
      text: 'Play 3 times',
    })
    assert.equal(parseDirection('(2nd x a cappella)')?.kind, 'text')
    assert.equal(parseDirection('13'), null)
    assert.equal(parseDirection('  '), null)
    assert.equal(parseDirection('\ue1d5'), null)
  })
})
