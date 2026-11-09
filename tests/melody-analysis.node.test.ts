import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extremesOf, formatBeats, songMelody } from '../src/js/melody-analysis.ts'
import { sampleRecord } from './score-sample.ts'

const record = sampleRecord('u1')

describe('a song’s melody analysis', () => {
  it('reads the range and the beats on its ends from the stored score', () => {
    const found = songMelody({ key: 'C' } as never, record)
    assert.deepEqual(found?.range, { low: 60, high: 67 })
    assert.equal(found?.rangeKey, 'C')
    assert.equal(found?.extremes?.highBeats, 3)
    assert.equal(found?.extremes?.lowBeats, 1)
  })

  it('lets a range typed into the chart win, and still reports the melody’s own extremes', () => {
    const found = songMelody({ key: 'C', x_chordless_range: 'A3-C5' } as never, record)
    assert.deepEqual(found?.range, { low: 57, high: 72 })
    assert.equal(found?.extremes?.highBeats, 3)
  })

  it('has nothing for a song with no melody and no range, and the typed range alone for one with no melody', () => {
    assert.equal(songMelody({ key: 'C' } as never, undefined), null)
    const typed = songMelody({ key: 'C', x_chordless_range: 'A3-C5' } as never, undefined)
    assert.equal(typed?.extremes, null)
    assert.deepEqual(typed?.range, { low: 57, high: 72 })
  })

  it('takes the melody’s key, or the chart’s when it has none, and reads a score once', () => {
    assert.equal(songMelody({ key: 'D' } as never, sampleRecord('u2', null))?.rangeKey, 'D')
    assert.equal(songMelody({ key: 'D' } as never, sampleRecord('u3', 'G'))?.rangeKey, 'G')
    assert.equal(songMelody({} as never, sampleRecord('u4', null))?.rangeKey, '')
    assert.equal(extremesOf(record), extremesOf(record))
  })

  it('has no extremes for a score that will not read, and uses the typed range', () => {
    const broken = { ...record, xml: 'not xml', contentHash: 'broken' }
    assert.equal(extremesOf(broken), null)
    assert.equal(songMelody({ key: 'C' } as never, broken), null)
    assert.deepEqual(songMelody({ key: 'C', x_chordless_range: 'A3-C5' } as never, broken)?.range, {
      low: 57,
      high: 72,
    })
  })

  it('says beats as people do', () => {
    assert.deepEqual([0, 0.25, 1, 2.5, 3.75, 3.9].map(formatBeats), [
      '0',
      '¼',
      '1',
      '2½',
      '3¾',
      '4',
    ])
  })
})
