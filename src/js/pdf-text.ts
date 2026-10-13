/**
 * The text of a PDF chart, for email-mime.ts's readEmail (its PdfReader). It uses unpdf, a build
 * of pdf.js that runs in a Worker as well as in Node and the browser. This is what finds the CCLI
 * number, key and tempo in the charts that come with an email.
 *
 * A PDF that cannot be read (damaged, encrypted, or just a scan with no text) gives '': the chart
 * is then known by its filename alone.
 */
import { extractText, getDocumentProxy } from 'unpdf'

export async function readPdfText(pdf: ArrayBuffer): Promise<string> {
  try {
    const document = await getDocumentProxy(new Uint8Array(pdf))
    const { text } = await extractText(document, { mergePages: false })
    return text.join('\n')
  } catch (error) {
    console.warn('Could not read a PDF:', error)
    return ''
  }
}
