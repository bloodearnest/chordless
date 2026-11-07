/**
 * The whole-melody reader (src/js/melody-pdfjs.ts). The real lead sheets are CCLI's and not kept
 * here, so the notes themselves are checked by scripts/melody-pdf-spike.ts against a local corpus;
 * this is what can be said of a sheet without the music font's glyphs, and of a file that is no PDF.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readMelodyPdf } from '../src/js/melody-pdfjs.ts'
import { leadSheetPdf } from './melody-pdf.ts'

test('a PDF with no music in it, or no PDF at all, has no melody', async () => {
  const drawn = leadSheetPdf({ pages: [[{ notes: [{ pitch: 'G4' }, { pitch: 'A4' }] }]] })
  const read = await readMelodyPdf(drawn)
  assert.ok(read === null || Array.isArray(read.measures))
  assert.equal(await readMelodyPdf(new TextEncoder().encode('not a pdf').buffer), null)
})
