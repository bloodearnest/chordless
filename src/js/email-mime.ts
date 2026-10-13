/**
 * Reading a raw email (an .eml file, as the email Worker is given or a file picked on a page)
 * into the text email-setlist.ts works from: sender, subject, date, body and the attached charts.
 *
 * Reading the text of a PDF is passed in, as the page and the Worker use different readers (and
 * the reconciler, which only needs the charts' names, uses none).
 */
import PostalMime, { type Email } from 'postal-mime'
import { type ChartInfo, type EmailText, parseChartText } from './email-setlist.ts'

/** The text of a PDF's pages in reading order, or '' if it has none to read */
export type PdfReader = (pdf: ArrayBuffer) => Promise<string>

const isPdf = (attachment: { mimeType: string; filename: string | null }) =>
  attachment.mimeType === 'application/pdf' || /\.pdf$/i.test(attachment.filename ?? '')

/** A plain text version of an HTML body, for an email that has no text one */
export function textOfHtml(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function chartsOf(email: Email, readPdf: PdfReader): Promise<ChartInfo[]> {
  const charts: ChartInfo[] = []
  for (const attachment of email.attachments) {
    if (!isPdf(attachment)) continue
    const content = attachment.content
    const buffer = typeof content === 'string' ? new TextEncoder().encode(content).buffer : content
    charts.push(
      parseChartText(await readPdf(buffer as ArrayBuffer), attachment.filename ?? 'chart.pdf')
    )
  }
  return charts
}

/**
 * The email as text. A message attached to it (a "forward as attachment", which Gmail offers and
 * Outlook does by default) is read in place of it: it is the message that was forwarded, so its
 * sender is the leader. The PDFs of both are the charts.
 */
export async function readEmail(
  raw: ArrayBuffer | Uint8Array | string,
  readPdf: PdfReader = async () => ''
): Promise<EmailText> {
  const email = await PostalMime.parse(raw)
  const charts = await chartsOf(email, readPdf)
  const attached = email.attachments.find(a => a.mimeType === 'message/rfc822')
  if (attached) {
    const inner = await readEmail(attached.content as ArrayBuffer, readPdf)
    return { ...inner, charts: [...charts, ...inner.charts] }
  }
  const dateHeader = email.headers.find(header => header.key === 'date')?.value
  return {
    subject: email.subject ?? '',
    from: {
      name: email.from?.name || email.from?.address?.split('@')[0] || '',
      email: (email.from?.address ?? '').toLowerCase(),
    },
    date: dateHeader ?? email.date ?? '',
    body: email.text ?? textOfHtml(email.html ?? ''),
    charts,
  }
}
