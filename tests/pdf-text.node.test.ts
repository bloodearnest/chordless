/**
 * Reading the text of a PDF chart (src/js/pdf-text.ts), with a small PDF made here.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readPdfText } from '../src/js/pdf-text.ts'

/** A one-page PDF with a line of text on it */
function pdfWith(text: string): ArrayBuffer {
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = objects.map((body, index) => {
    const offset = out.length
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out).buffer as ArrayBuffer
}

test('gives the text on the pages of a PDF', async () => {
  assert.match(await readPdfText(pdfWith('Amazing Grace - Key of G')), /Amazing Grace - Key of G/)
})

test('gives nothing for a file that is not a PDF, rather than failing', async () => {
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.equal(await readPdfText(new TextEncoder().encode('not a pdf').buffer as ArrayBuffer), '')
  } finally {
    console.warn = warn
  }
})
