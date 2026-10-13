/**
 * The email Worker: a leader's email forwarded to the import address is read and answered with a
 * link, /import-setlist#<the setlist>. Nothing is stored: the email is read in memory (the PDFs only
 * for their title, key, tempo and CCLI number) and what the link holds is those, the songs and the
 * leader's name and email. Never a PDF, never the body, never the To: or Cc: lists of other people.
 *
 * The Cloudflare parts (the message, and the class that makes a reply) are passed in, so this can
 * be tested: see index.ts for where they come from, and docs/EMAIL_IMPORT.md for the set-up.
 */
import { encodeImport } from '../../src/js/email-link.ts'
import { readEmail } from '../../src/js/email-mime.ts'
import { importFromEmail } from '../../src/js/email-setlist.ts'
import { readPdfText } from '../../src/js/pdf-text.ts'

/** The part of Cloudflare's ForwardableEmailMessage used here */
export interface IncomingEmail {
  readonly from: string
  readonly to: string
  readonly raw: ReadableStream<Uint8Array>
  readonly rawSize: number
  readonly headers: { get(name: string): string | null }
  reply(message: unknown): Promise<void>
}

/** Makes the message a reply is sent as (Cloudflare's EmailMessage) */
export type MakeReply = (from: string, to: string, raw: string) => unknown

/** Emails bigger than this are not read: a setlist is a few PDFs */
const MAX_BYTES = 25 * 1024 * 1024

const CRLF = '\r\n'

/** A plain text reply, as the raw message Cloudflare sends */
export function replyMessage(options: {
  from: string
  to: string
  subject: string
  inReplyTo: string | null
  body: string
}): string {
  const headers = [
    `From: Chordless <${options.from}>`,
    `To: ${options.to}`,
    `Subject: ${options.subject.replace(/[\r\n]+/g, ' ')}`,
    `Message-ID: <${crypto.randomUUID()}@${options.from.split('@')[1] ?? 'chordless.app'}>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ]
  if (options.inReplyTo) {
    headers.push(`In-Reply-To: ${options.inReplyTo}`, `References: ${options.inReplyTo}`)
  }
  const bytes = new TextEncoder().encode(options.body)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const body = btoa(binary).replace(/.{76}/g, `$&${CRLF}`)
  return headers.join(CRLF) + CRLF + CRLF + body + CRLF
}

/** What the reply says: the link, or why there isn't one */
export async function answerFor(
  raw: ArrayBuffer,
  origin: string
): Promise<{ subject: string; body: string }> {
  try {
    const setlist = importFromEmail(await readEmail(raw, readPdfText))
    if (!setlist.songs.length && !setlist.unlisted.length) {
      return {
        subject: 'No songs found',
        body: 'Chordless could not find a list of songs in that email.\n\nForward the email with the song list in its body, and the charts attached as PDFs.\n',
      }
    }
    const link = `${origin}/import-setlist#${await encodeImport(setlist)}`
    const count = setlist.songs.length + setlist.unlisted.length
    return {
      subject: `Your setlist: ${setlist.name || 'Chordless'}`,
      body: [
        `Chordless found ${count} song${count === 1 ? '' : 's'}${setlist.date ? ` for ${setlist.date}` : ''}.`,
        '',
        'Open this link to check them and make the setlist:',
        link,
        '',
        'The charts are not kept: the link holds only the titles, keys and CCLI numbers, and it is read on your own device.',
        '',
      ].join('\n'),
    }
  } catch (error) {
    console.error('[email] could not read an email:', error)
    return {
      subject: 'Could not read that email',
      body: 'Chordless could not read that email. Forward it again, or choose the .eml file on the Import a Setlist page.\n',
    }
  }
}

export async function handleEmail(
  message: IncomingEmail,
  makeReply: MakeReply,
  origin: string
): Promise<void> {
  if (message.rawSize > MAX_BYTES) return
  const raw = await new Response(message.raw).arrayBuffer()
  const { subject, body } = await answerFor(raw, origin)
  // Always to the sender of this email: the reply cannot be sent anywhere else
  const reply = replyMessage({
    from: message.to,
    to: message.from,
    subject,
    inReplyTo: message.headers.get('Message-ID'),
    body,
  })
  await message.reply(makeReply(message.to, message.from, reply))
}
