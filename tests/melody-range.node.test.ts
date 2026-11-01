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

/** The sheet read, whole */
async function readOf(pages: SheetStaff[][], space?: number, strayRestore?: boolean) {
  return readMelodyRange(leadSheetPdf({ pages, space, strayRestore }))
}

/** Just the range of it */
async function rangeOf(pages: SheetStaff[][], space?: number, strayRestore?: boolean) {
  const read = await readOf(pages, space, strayRestore)
  return read && { low: read.low, high: read.high }
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

test('a key signature of many sharps is read in full', async () => {
  // B major: F, C, G, D and A are sharp
  const range = await rangeOf([[{ key: 5, notes: notes('A4', 'F5') }]])
  assert.deepEqual(range, { low: midi('A#4'), high: midi('F#5') })
})

test('a mark far from any staff is not a note', async () => {
  const range = await rangeOf([[{ notes: notes('G4', 'C7', 'E5') }]])
  assert.deepEqual(range, { low: midi('G4'), high: midi('E5') })
})

test('a restore with nothing to restore does not stop the page being read', async () => {
  const range = await rangeOf([[{ notes: notes('G4', 'E5') }]], undefined, true)
  assert.deepEqual(range, { low: midi('G4'), high: midi('E5') })
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

test('nor is it added to a key signature that is there', async () => {
  // G major, and a sharp on the first note: only the key's sharps change F
  const range = await rangeOf([[{ key: 1, notes: notes('C5', 'D5'), accidentalOnFirstNote: true }]])
  assert.deepEqual(range, { low: midi('C5'), high: midi('D5') })
  const f = await rangeOf([[{ key: 1, notes: notes('F4'), accidentalOnFirstNote: true }]])
  assert.deepEqual(f, { low: midi('F#4'), high: midi('F#4') })
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

test('it says what it read: the notes, the pages and staves, and the key signature it opens with', async () => {
  const read = await readOf([
    [
      { key: 1, notes: [...notes('G4', 'B4'), { pitch: 'C4', head: 'cue' }] },
      { key: 1, notes: notes('D4', 'E5', 'A4') },
    ],
    [{ key: 1, notes: notes('F4') }],
  ])
  assert.ok(read)
  assert.equal(read.notes, 6)
  assert.equal(read.instrumental, 1)
  assert.equal(read.pages, 2)
  assert.equal(read.staves, 3)
  assert.equal(read.keySignature, 1)
})

test('it says where the lowest and highest notes are, counting the staves from the top', async () => {
  const read = await readOf([
    [{ notes: notes('G4', 'B4') }, { notes: notes('A4', 'E5') }, { notes: notes('D4', 'C5') }],
    [{ notes: notes('F4') }],
  ])
  assert.ok(read)
  assert.deepEqual(read.lowAt, { page: 1, staff: 3 })
  assert.deepEqual(read.highAt, { page: 1, staff: 2 })
})

test('the key signature is that of the staff the sheet opens with, flats as negative', async () => {
  const flats = await readOf([
    [
      { key: -2, notes: notes('G4') },
      { key: 3, notes: notes('G4') },
    ],
  ])
  assert.equal(flats?.keySignature, -2)
  const none = await readOf([[{ notes: notes('G4') }]])
  assert.equal(none?.keySignature, 0)
})

test('a first staff of only an instrumental line still gives the key', async () => {
  const read = await readOf([
    [
      { key: -3, notes: [{ pitch: 'G4', head: 'cue' as const }] },
      { key: -3, notes: notes('D4', 'F4') },
    ],
  ])
  assert.equal(read?.keySignature, -3)
  assert.equal(read?.instrumental, 1)
})

const unlyriced = (...pitches: string[]): SheetNote[] =>
  pitches.map(pitch => ({ pitch, lyric: false }))

test('a full-size measure with no lyric under it is not sung, so it does not count', async () => {
  const read = await readOf([
    [{ notes: [...notes('G4', 'A4', 'B4', 'C5'), ...unlyriced('E4', 'F4', 'G4', 'A5')] }],
  ])
  assert.ok(read)
  assert.deepEqual({ low: read.low, high: read.high }, { low: midi('G4'), high: midi('C5') })
  assert.equal(read.notes, 4)
  assert.equal(read.unsung, 4)
})

test('a run of notes on one syllable counts: it is the measure that has the lyric', async () => {
  const read = await readOf([[{ notes: [{ pitch: 'D4' }, ...unlyriced('E4', 'F4', 'G5')] }]])
  assert.ok(read)
  assert.deepEqual({ low: read.low, high: read.high }, { low: midi('D4'), high: midi('G5') })
  assert.equal(read.unsung, 0)
})

test('a note with its lyric after a measure of full-size notes with none counts, as a pickup does', async () => {
  const read = await readOf([[{ notes: [...unlyriced('C4', 'D4', 'E4', 'F4'), { pitch: 'G3' }] }]])
  assert.ok(read)
  assert.deepEqual({ low: read.low, high: read.high }, { low: midi('G3'), high: midi('G3') })
  assert.equal(read.unsung, 4)
})

test('the lyric is that of its own staff', async () => {
  const read = await readOf([[{ notes: unlyriced('C4', 'D4') }, { notes: notes('G4', 'A4') }]])
  assert.ok(read)
  assert.deepEqual({ low: read.low, high: read.high }, { low: midi('G4'), high: midi('A4') })
  assert.equal(read.unsung, 2)
})

test('a sheet with no lyrics at all is read by the size of the notes alone', async () => {
  const read = await readOf([[{ notes: unlyriced('E4', 'G5') }]])
  assert.ok(read)
  assert.deepEqual({ low: read.low, high: read.high }, { low: midi('E4'), high: midi('G5') })
  assert.equal(read.unsung, 0)
})

test('a sheet of only notes with no lyric among many that have one reads the ones that do', async () => {
  const read = await readOf([
    [{ notes: [...notes('G4', 'A4', 'B4', 'C5'), ...unlyriced('C4', 'D4', 'E4', 'F4')] }],
    [{ notes: unlyriced('A3', 'B3') }],
  ])
  assert.ok(read)
  assert.deepEqual({ low: read.low, high: read.high }, { low: midi('G4'), high: midi('C5') })
  assert.equal(read.unsung, 6)
})
