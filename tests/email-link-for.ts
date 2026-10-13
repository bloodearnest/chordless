// The link the email Worker would reply with for an email (see worker/src/email.ts): the page
// only opens links, so tests read the made-up email here, as the Worker does, and open the link.
import { encodeImport } from '../src/js/email-link.ts'
import { readEmail } from '../src/js/email-mime.ts'
import { importFromEmail } from '../src/js/email-setlist.ts'
import { readPdfText } from '../src/js/pdf-text.ts'

export async function linkFor(raw: Buffer): Promise<string> {
  const setlist = importFromEmail(await readEmail(raw, readPdfText))
  return `/import-setlist#${await encodeImport(setlist)}`
}
