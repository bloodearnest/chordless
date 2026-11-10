import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { chartTexts, cueMeasures, sliceMeasures, songCues } from '../src/js/score-section.ts'
import { bar, melodyOf, note, rest } from './score-build.ts'

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

  it('gives nothing for a sheet section whose name the chart has used up', () => {
    const twice = melodyOf('Song', [
      bar([note('E', 5, { cue: true, duration: 4 })], { section: 'INSTRUMENTAL' }),
      bar([note('G', 5, { cue: true, duration: 4 })], { section: 'INSTRUMENTAL' }),
    ])
    assert.deepEqual(cueMeasures(twice, [{ label: 'Instrumental', text: '' }]), [[0]])
  })

  it('takes a lead-in bar before the intro box, and ends a pickup into the verse at its cue notes', () => {
    // (as one sheet has it: a short bar, INTRO of three bars, the last with a sung pickup note and a cue note)
    const lead = melodyOf('Song', [
      bar([note('B', 3, { cue: true, duration: 3 })], { number: 1, full: false, length: 3 }),
      bar([note('G', 3, { cue: true, duration: 4 })], { number: 2, section: 'INTRO' }),
      bar([note('C', 4, { cue: true, duration: 4 })], { number: 3 }),
      bar(
        [
          note('B', 3, { cue: true, duration: 4 }),
          note('B', 3, { start: 3.75, duration: 0.25, syllables: ['A'] }),
        ],
        { number: 4 }
      ),
      bar([note('D', 4, { duration: 4, syllables: ['thousand'] })], {
        number: 5,
        section: 'VERSE 1',
      }),
    ])
    const found = cueMeasures(lead, [
      { label: 'Intro', text: '' },
      { label: 'Verse 1', text: 'A thousand generations' },
    ])
    assert.deepEqual(found, [[0, 1, 2, 3], null])
    const cut = sliceMeasures(lead, [3])
    assert.deepEqual(
      cut.measures[0]?.voices.flat().map(e => e.kind === 'note' && e.cue),
      [true]
    )
  })

  it('takes a first part with no box as the intro, and ends an instrumental where the singing starts', () => {
    const open = melodyOf('Song', [
      bar([note('C', 4, { cue: true, duration: 4 })], { number: 1 }),
      bar([note('D', 4, { cue: true, duration: 4 })], { number: 2 }),
      bar([note('E', 4, { duration: 4, syllables: ['sing'] })], { number: 3, section: 'VERSE' }),
      bar([note('G', 4, { cue: true, duration: 4 })], { number: 4, section: 'INSTRUMENTAL' }),
      bar([note('A', 4, { cue: true, duration: 4 })], { number: 5 }),
      // (the sheet does not box what follows)
      bar([note('B', 4, { duration: 4, syllables: ['sing'] })], { number: 6 }),
    ])
    const found = cueMeasures(open, [
      { label: 'Intro', text: '' },
      { label: 'Verse 1', text: 'sing sing' },
      { label: 'Instrumental', text: '' },
    ])
    assert.deepEqual(found, [[0, 1], null, [3, 4]])
  })

  it('skips a first measure that holds a note over from the part before, and finds names that differ', () => {
    const held = melodyOf('Song', [
      bar([note('E', 4, { duration: 4, syllables: ['sing'] })], { number: 1, section: 'VERSE' }),
      // (a sung note tied over, then the cue notes)
      bar(
        [
          note('E', 4, { duration: 4, tieStop: true, syllables: [''] }),
          note('G', 5, { cue: true, start: 2, duration: 2 }),
        ],
        { number: 2, section: 'INTRO / TURNAROUND' }
      ),
      bar([note('A', 5, { cue: true, duration: 4 })], { number: 3 }),
      bar([note('B', 4, { duration: 4, syllables: ['sing'] })], { number: 4, section: 'CHORUS' }),
    ])
    const found = cueMeasures(held, [
      { label: 'Verse', text: 'sing' },
      { label: 'Intro', text: '' },
      { label: 'Turnaround 1b', text: '(To Br.)' },
    ])
    // (one sheet section with two names gives its notes to both, and brackets are not words)
    assert.deepEqual(found, [null, [1, 2], [1, 2]])
    const labelled = cueMeasures(held, [
      { label: 'Outro  -  5/4', text: '' },
      { label: 'Intro / Turnaround', text: '' },
    ])
    assert.deepEqual(labelled, [null, [1, 2]])
  })

  it('gives nothing for an instrumental that the singing interrupts, and the next one when it is whole', () => {
    const broken = melodyOf('Song', [
      bar([note('E', 5, { cue: true, duration: 4 })], { number: 1, section: 'INSTRUMENTAL' }),
      bar([note('E', 4, { duration: 4, syllables: ['oh'] })], { number: 2 }),
      bar([note('G', 5, { cue: true, duration: 4 })], { number: 3 }),
      bar([note('A', 5, { cue: true, duration: 4 })], { number: 4, section: 'INSTRUMENTAL' }),
    ])
    const found = cueMeasures(broken, [{ label: 'Instrumental', text: '' }])
    assert.deepEqual(found, [[3]])
    assert.deepEqual(
      cueMeasures({ ...broken, measures: broken.measures.slice(0, 3) }, [
        { label: 'Instrumental', text: '' },
      ]),
      [null]
    )
  })

  it('skips a first measure with only the held note, stops at a measure with no notes, and keeps one with a harmony line after it', () => {
    const sheet2 = melodyOf('Song', [
      bar([note('E', 4, { duration: 4, syllables: ['sing'] })], { number: 1, section: 'VERSE' }),
      // (only the note held over, and a rest)
      bar([note('E', 4, { duration: 4, tieStop: true, syllables: [''] }), rest({ start: 3 })], {
        number: 2,
        section: 'INSTRUMENTAL',
      }),
      bar([note('G', 5, { cue: true, duration: 4 })], { number: 3 }),
      // (nothing at all: the part ends)
      bar([rest({ duration: 4, wholeMeasure: true })], { number: 4 }),
      // (later, a harmony line over singing is not more of the instrumental)
      bar(
        [
          note('A', 4, { duration: 4, syllables: ['la'] }),
          note('C', 5, { cue: true, duration: 4 }),
        ],
        { number: 5 }
      ),
    ])
    assert.deepEqual(cueMeasures(sheet2, [{ label: 'Instrumental', text: '' }]), [[2]])
  })

  it('gives nothing for a part with words, even when the sheet has cue notes for it', () => {
    const found = cueMeasures(sheet, [{ label: 'Intro', text: 'oh oh oh' }])
    assert.deepEqual(found, [null])
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

describe('the cues of a song', () => {
  const parsed = {
    metadata: {},
    sections: [
      {
        type: 'section' as const,
        label: 'Intro',
        lines: [{ segments: [{ chord: 'G', lyrics: '' }] }],
      },
      {
        type: 'section' as const,
        label: null,
        lines: [
          {
            segments: [
              { chord: 'G', lyrics: 'Lord ' },
              { chord: 'C', lyrics: 'hear' },
            ],
          },
        ],
      },
    ],
  } as unknown as Parameters<typeof songCues>[1]

  it('reads the words of each chart section', () => {
    assert.deepEqual(chartTexts(parsed as NonNullable<typeof parsed>), [
      { label: 'Intro', text: '' },
      { label: '', text: 'Lord hear' },
    ])
  })

  it('has the measures of each section of the chart, and none for a song with nothing to show', () => {
    const cues = songCues({ melody: sheet, key: 'C' }, parsed)
    assert.equal(cues?.key, 'C')
    assert.deepEqual(cues?.measures, [[0, 1], null])
    assert.equal(songCues(null, parsed), null)
    assert.equal(songCues({ melody: sheet, key: 'C' }, null), null)
    const bare = melodyOf('Song', [bar([note('C', 4, { duration: 4 })])])
    assert.equal(songCues({ melody: bare, key: 'C' }, parsed), null)
  })
})
