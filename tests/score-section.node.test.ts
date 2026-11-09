import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cueMeasures, sliceMeasures } from '../src/js/score-section.ts'
import { bar, melodyOf, note } from './score-build.ts'

/** An intro of two cue-size bars, a verse of sung bars, an instrumental of one bar, a chorus */
const sheet = melodyOf('Song', [
  bar([note('E', 5, { cue: true, duration: 4 })], { number: 1, section: 'INTRO' }),
  bar([note('D', 5, { cue: true, duration: 4 })], { number: 2 }),
  bar([note('C', 4, { duration: 4, syllables: ['Lord'] })], { number: 3, section: 'VERSE 1' }),
  bar([note('D', 4, { duration: 4, syllables: ['hear'] })], { number: 4 }),
  bar([note('G', 4, { cue: true, duration: 4 })], { number: 5, section: 'INSTRUMENTAL' }),
  bar([note('A', 4, { duration: 4, syllables: ['sing'] })], { number: 6, section: 'CHORUS' }),
])

const chart = [
  { label: 'Intro', text: '' },
  { label: 'Verse 1', text: 'Lord hear my prayer tonight' },
  { label: 'Instrumental', text: '' },
  { label: 'Chorus', text: 'sing sing sing' },
]

describe('the notes of a chart section', () => {
  it('finds the measures of the sections that have notes and nothing sung', () => {
    const found = cueMeasures(sheet, chart)
    assert.deepEqual(found[0], [0, 1])
    assert.deepEqual(found[2], [4])
  })

  it('gives nothing for a sung section', () => {
    const found = cueMeasures(sheet, chart)
    assert.equal(found[1], null)
    assert.equal(found[3], null)
  })

  it('gives nothing for a chart section the sheet has no name for', () => {
    const found = cueMeasures(sheet, [...chart, { label: 'Bridge', text: '' }])
    assert.equal(found[4], null)
  })

  it('gives nothing for a sheet with no cue notes', () => {
    const plain = melodyOf('Song', [bar([note('C', 4, { duration: 4 })], { section: 'INTRO' })])
    assert.deepEqual(cueMeasures(plain, [{ label: 'Intro', text: '' }]), [null])
  })

  it('takes two sections of one name in turn', () => {
    const twice = melodyOf('Song', [
      bar([note('E', 5, { cue: true, duration: 4 })], { section: 'INSTRUMENTAL' }),
      bar([note('A', 4, { duration: 4, syllables: ['sing'] })], { section: 'CHORUS' }),
      bar([note('G', 5, { cue: true, duration: 4 })], { section: 'INSTRUMENTAL' }),
    ])
    const found = cueMeasures(twice, [
      { label: 'Instrumental', text: '' },
      { label: 'Chorus', text: 'sing sing sing' },
      { label: 'Instrumental', text: '' },
    ])
    assert.deepEqual(found[0], [0])
    assert.deepEqual(found[2], [2])
  })

  it('cuts the measures out with no title, notice or section box', () => {
    const cut = sliceMeasures({ ...sheet, notice: ['CCLI 1'] }, [0, 1])
    assert.equal(cut.title, null)
    assert.deepEqual(cut.notice, [])
    assert.deepEqual(
      cut.measures.map(m => [m.number, m.section]),
      [
        [1, null],
        [2, null],
      ]
    )
  })
})
