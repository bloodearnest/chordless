/**
 * A small real PDF with some lines of text, for tests of reading a chart's PDF without keeping
 * any copyrighted chart in the repository. Text only: no fonts are embedded (it uses Helvetica).
 */
export function makePdf(lines: string[]): Buffer {
  const escapeText = (text: string) => text.replace(/[\\()]/g, c => `\\${c}`)
  const text = lines.map((line, i) => `${i === 0 ? '' : 'T* '}(${escapeText(line)}) Tj`).join('\n')
  const stream = `BT /F1 12 Tf 14 TL 72 720 Td\n${text}\nET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}
