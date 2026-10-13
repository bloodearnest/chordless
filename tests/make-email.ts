import { makePdf } from './make-pdf.ts'

/**
 * A made-up email, as an .eml: a list in the body, and small PDFs attached (tests/make-pdf.ts).
 * Real emails are not used in committed tests, as their charts are copyrighted.
 */
export function email(
  subject: string,
  list: string[],
  pdfs: { name: string; lines: string[] }[] = []
) {
  const parts = [
    'From: Leader One <One@Example.com>',
    'To: Ann <ann@example.com>',
    `Subject: ${subject}`,
    'Date: Fri, 9 Oct 2026 18:11:00 +0100',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="B"',
    '',
    '--B',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hi all',
    ...list,
    '',
  ]
  for (const pdf of pdfs) {
    parts.push(
      '--B',
      `Content-Type: application/pdf; name="${pdf.name}"`,
      `Content-Disposition: attachment; filename="${pdf.name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      makePdf(pdf.lines).toString('base64'),
      ''
    )
  }
  parts.push('--B--', '')
  return Buffer.from(parts.join('\r\n'))
}
