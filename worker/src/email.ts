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
import { cleanSubject, importFromEmail } from '../../src/js/email-setlist.ts'
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

/** A reply's two versions: for mail programs that show only plain text, and the one most show */
export interface Answer {
  text: string
  html: string
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)

function base64Lines(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/.{76}/g, `$&${CRLF}`)
}

/** A reply, as the raw message Cloudflare sends: plain text and HTML versions of the same words */
export function replyMessage(options: {
  from: string
  to: string
  subject: string
  inReplyTo: string | null
  /** The References: the reply goes with (see handleEmail) */
  references: string | null
  answer: Answer
}): string {
  const boundary = `chordless-${crypto.randomUUID()}`
  const headers = [
    `From: Chordless <${options.from}>`,
    `To: ${options.to}`,
    `Subject: ${options.subject.replace(/[\r\n]+/g, ' ')}`,
    `Message-ID: <${crypto.randomUUID()}@${options.from.split('@')[1] ?? 'chordless.app'}>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
  if (options.inReplyTo) {
    headers.push(
      `In-Reply-To: ${options.inReplyTo}`,
      `References: ${options.references || options.inReplyTo}`
    )
  }
  const part = (type: string, text: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=utf-8`,
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(text),
    ].join(CRLF)
  return (
    headers.join(CRLF) +
    CRLF +
    CRLF +
    [
      part('text/plain', options.answer.text),
      part('text/html', options.answer.html),
      `--${boundary}--`,
      '',
    ].join(CRLF)
  )
}

/** A message in the reply's page: a heading and paragraphs, with a link if there is one */
function page(heading: string, paragraphs: string[]): string {
  const style = 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a2233'
  return `<div style="${style};max-width:34rem;margin:0;padding:0;line-height:1.5">
<h2 style="margin:0 0 .75rem;font-size:1.25rem">${escapeHtml(heading)}</h2>
${paragraphs.join('\n')}
</div>`
}

const paragraph = (html: string, extra = '') => `<p style="margin:0 0 .75rem;${extra}">${html}</p>`

const FOOTNOTE =
  'The charts are not kept: the link holds only the titles, keys and CCLI numbers, and your own device reads it.'

/** What the reply says: the setlist found and the link, or why there isn't one */
export async function answerFor(raw: ArrayBuffer, origin: string): Promise<Answer> {
  try {
    const setlist = importFromEmail(await readEmail(raw, readPdfText))
    if (!setlist.songs.length && !setlist.unlisted.length) {
      const words = 'Chordless could not find a list of songs in that email.'
      const advice =
        'Forward the email with the song list in its body, and the charts attached as PDFs.'
      return {
        text: `${words}\n\n${advice}\n`,
        html: page('No songs found', [paragraph(words), paragraph(advice)]),
      }
    }
    const link = `${origin}/import-setlist#${await encodeImport(setlist)}`
    const shown = `${origin.replace(/^https?:\/\//, '')}/import-setlist#…`
    const leader = setlist.leader.name || setlist.leader.email
    const details: [string, string][] = [
      ['Setlist', setlist.name || '(no name)'],
      [
        'Date',
        setlist.date
          ? setlist.date + (setlist.dateWarning ? ` (${setlist.dateWarning})` : '')
          : 'none found: you will be asked',
      ],
      ['Led by', leader ? leader : 'not found'],
    ]
    const songLine = (song: { title: string; key: string | null }) =>
      song.key ? `${song.title} (${song.key})` : song.title
    const text = [
      'Chordless read your email as a setlist.',
      '',
      ...details.map(([label, value]) => `${label}: ${value}`),
      '',
      'Songs:',
      ...setlist.songs.map((song, index) => `${index + 1}. ${songLine(song)}`),
      ...(setlist.unlisted.length
        ? ['', 'Attached, but not in the list:', ...setlist.unlisted.map(s => `- ${songLine(s)}`)]
        : []),
      '',
      'Review them and make the setlist:',
      link,
      '',
      FOOTNOTE,
      '',
    ].join('\n')
    const list = (tag: 'ol' | 'ul', songs: { title: string; key: string | null }[]) =>
      `<${tag} style="margin:0 0 .75rem;padding-left:1.5rem">${songs
        .map(song => `<li>${escapeHtml(songLine(song))}</li>`)
        .join('')}</${tag}>`
    const html = page('Your setlist is ready to check', [
      paragraph(
        details
          .map(
            ([label, value]) =>
              `<span style="color:#5b667a">${escapeHtml(label)}</span> <strong>${escapeHtml(value)}</strong>`
          )
          .join('<br>')
      ),
      paragraph('<strong>Songs</strong>', 'margin-bottom:.25rem'),
      list('ol', setlist.songs),
      ...(setlist.unlisted.length
        ? [
            paragraph('Attached, but not in the list:', 'margin-bottom:.25rem'),
            list('ul', setlist.unlisted),
          ]
        : []),
      paragraph(
        `<a href="${escapeHtml(link)}" style="display:inline-block;background:#1f3a68;color:#ffffff;text-decoration:none;padding:.6rem 1.1rem;border-radius:.4rem;font-weight:600">Review and create the setlist</a>`,
        'margin-top:1rem'
      ),
      paragraph(
        `<a href="${escapeHtml(link)}" style="color:#5b667a">${escapeHtml(shown)}</a>`,
        'font-size:.85rem'
      ),
      paragraph(escapeHtml(FOOTNOTE), 'font-size:.85rem;color:#5b667a'),
    ])
    return { text, html }
  } catch (error) {
    console.error('[email] could not read an email:', error)
    const words =
      'Chordless could not read that email. Forward it again, or choose the .eml file on the Import a Setlist page.'
    return { text: `${words}\n`, html: page('Could not read that email', [paragraph(words)]) }
  }
}

/** Cloudflare's Rate Limiting binding: success is false once the key has used its allowance */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/** The limits to apply to the emails that come in, if any (see wrangler.toml) */
export interface EmailLimits {
  /** Per sender address */
  perSender?: RateLimit
  /** Over all senders: forged addresses get past a limit per sender */
  overall?: RateLimit
}

/** An email over a limit is dropped without a reply: a reply would be the abuse */
async function allowed(sender: string, limits: EmailLimits): Promise<boolean> {
  try {
    const checks = [
      limits.perSender?.limit({ key: sender.toLowerCase() }),
      limits.overall?.limit({ key: 'all' }),
    ]
    return (await Promise.all(checks)).every(result => result?.success !== false)
  } catch (error) {
    // The limit is for protection: if it fails, the leader still gets their reply
    console.error('[email] could not check the rate limit:', error)
    return true
  }
}

export async function handleEmail(
  message: IncomingEmail,
  makeReply: MakeReply,
  origin: string,
  limits: EmailLimits = {}
): Promise<void> {
  if (message.rawSize > MAX_BYTES) return
  if (!(await allowed(message.from, limits))) {
    console.warn('[email] over the rate limit: not answered')
    return
  }
  const raw = await new Response(message.raw).arrayBuffer()
  const answer = await answerFor(raw, origin)
  // The subject of the email it came from, so a mail program puts the reply in its conversation
  const subject = `Re: ${cleanSubject(message.headers.get('Subject') ?? '') || 'your setlist'}`
  const messageId = message.headers.get('Message-ID')
  // Cloudflare refuses a reply whose References are not the email's own followed by its
  // Message-ID: a forwarded email has others before it
  const earlier = message.headers.get('References')?.trim()
  const references = [earlier, messageId].filter(Boolean).join(' ')
  // Always to the sender of this email: the reply cannot be sent anywhere else
  const reply = replyMessage({
    from: message.to,
    to: message.from,
    subject,
    inReplyTo: messageId,
    references,
    answer,
  })
  await message.reply(makeReply(message.to, message.from, reply))
}
