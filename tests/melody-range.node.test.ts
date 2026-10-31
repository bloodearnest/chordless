/**
 * The range of a lead sheet's tune (src/js/melody-range.ts), read from lead sheets drawn the way
 * SongSelect draws them (tests/melody-pdf.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readMelodyRange } from '../src/js/melody-range.ts'
import { leadSheetPdf, type SheetNote, type SheetStaff } from './melody-pdf.ts'

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** MIDI number of a note name like 'D4', 'F#5' or 'Bb3' */
function midi(name: string): number {
  const [, letter, accidental, octave] = /^([A-G])([#b]?)(\d)$/.exec(name) ?? []
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
  return 12 * (Number(octave) + 1) + SEMITONES[letter] + shift
}

const notes = (...pitches: string[]): SheetNote[] => pitches.map(pitch => ({ pitch }))

async function rangeOf(pages: SheetStaff[][], space?: number) {
  return readMelodyRange(leadSheetPdf({ pages, space }))
}

test('the range is the lowest and highest note, across staves and pages', async () => {
  const range = await rangeOf([
    [{ notes: notes('G4', 'B4', 'D5') }, { notes: notes('E4', 'A4') }],
    [{ notes: notes('C5', 'E5') }],
  ])
  assert.deepEqual(range, { low: midi('E4'), high: midi('E5') })
})

test('notes on ledger lines get their octave', async () => {
  const range = await rangeOf([[{ notes: notes('C4', 'A5', 'G4') }]])
  assert.deepEqual(range, { low: midi('C4'), high: midi('A5') })
})

test('a staff of one note is a range of one note', async () => {
  assert.deepEqual(await rangeOf([[{ notes: notes('G4') }]]), {
    low: midi('G4'),
    high: midi('G4'),
  })
})

test('small noteheads are an instrumental line, not sung, so they do not widen the range', async () => {
  const range = await rangeOf([
    [
      {
        notes: [
          { pitch: 'G3', head: 'cue' },
          { pitch: 'D4' },
          { pitch: 'E5' },
          { pitch: 'C6', head: 'cue' },
        ],
      },
    ],
  ])
  assert.deepEqual(range, { low: midi('D4'), high: midi('E5') })
})

test('hollow noteheads (a minim, a semibreve) count', async () => {
  const range = await rangeOf([
    [{ notes: [{ pitch: 'G4' }, { pitch: 'C4', head: 'ring' }, { pitch: 'F5', head: 'ring' }] }],
  ])
  assert.deepEqual(range, { low: midi('C4'), high: midi('F5') })
})

test('a different size of page reads the same: sizes are measured in staff spaces', async () => {
  const pages = [
    [{ notes: [{ pitch: 'D4' }, { pitch: 'E5' }, { pitch: 'A3', head: 'cue' as const }] }],
  ]
  for (const space of [3.2, 4.6, 7]) {
    assert.deepEqual(await rangeOf(pages, space), { low: midi('D4'), high: midi('E5') })
  }
})

test('the key signature sharpens or flattens the notes it names', async () => {
  // G major: F is sharp
  assert.deepEqual(await rangeOf([[{ key: 1, notes: notes('D4', 'F5') }]]), {
    low: midi('D4'),
    high: midi('F#5'),
  })
  // A major: F, C and G are sharp
  assert.deepEqual(await rangeOf([[{ key: 3, notes: notes('G4', 'C5') }]]), {
    low: midi('G#4'),
    high: midi('C#5'),
  })
  // B flat major: B and E are flat
  assert.deepEqual(await rangeOf([[{ key: -2, notes: notes('B3', 'E5', 'F4') }]]), {
    low: midi('Bb3'),
    high: midi('Eb5'),
  })
  // C major: nothing
  assert.deepEqual(await rangeOf([[{ key: 0, notes: notes('F4', 'F5') }]]), {
    low: midi('F4'),
    high: midi('F5'),
  })
})

test('a key signature is read for each staff, so a key change at a line is followed', async () => {
  const range = await rangeOf([
    [
      { key: 0, notes: notes('F4') },
      { key: 1, notes: notes('F5') },
    ],
  ])
  assert.deepEqual(range, { low: midi('F4'), high: midi('F#5') })
})

test('an accidental on the first note of a staff is not mistaken for a key signature', async () => {
  const range = await rangeOf([[{ key: 0, notes: notes('F4', 'F5'), accidentalOnFirstNote: true }]])
  assert.deepEqual(range, { low: midi('F4'), high: midi('F5') })
})

test('a sheet with no notes, or no music, or no PDF, has no range', async () => {
  assert.equal(await rangeOf([[{ notes: [] }]]), null)
  assert.equal(await rangeOf([[]]), null)
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.equal(
      await readMelodyRange(new TextEncoder().encode('not a pdf').buffer as ArrayBuffer),
      null
    )
  } finally {
    console.warn = warn
  }
})
