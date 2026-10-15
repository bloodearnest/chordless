/**
 * The email Worker's answer (worker/src/email.ts): a link in reply, with no Cloudflare.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeImport } from '../src/js/email-link.ts'
import { answerFor, handleEmail, type IncomingEmail, replyMessage } from '../worker/src/email.ts'
import { email } from './make-email.ts'

const PDF = {
  name: 'Brand New Song-chords-D.pdf',
  lines: ['Brand New Song', 'Key - D | Tempo - 90', 'CCLI Song # 1234567'],
}
const bytes = (buffer: Buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

/** A message as Cloudflare hands it to the Worker, which records whether and what it replied */
const fakeIncoming = ({
  from = 'sender@example.com',
  raw = email('Sunday 25th October', ['1. Alpha Song in G']),
  rawSize = raw.length,
  headers = {},
}: {
  from?: string
  raw?: string | Buffer
  rawSize?: number
  headers?: Record<string, string>
} = {}) => {
  const message: IncomingEmail & { replied: boolean; sent: unknown } = {
    from,
    to: 'import@chordless.test',
    rawSize,
    raw: new Response(typeof raw === 'string' ? raw : new Uint8Array(raw))
      .body as ReadableStream<Uint8Array>,
    headers: { get: name => headers[name] ?? null },
    replied: false,
    sent: undefined,
    reply: async reply => {
      message.replied = true
      message.sent = reply
    },
  }
  return message
}

test('an email with a list of songs is answered with a link that holds them', async () => {
  const { text: body, html } = await answerFor(
    bytes(email('Sunday 25th October', ['1. Alpha Song in G', '2. Brand New Song in D'], [PDF])),
    'https://chordless.test'
  )
  const link = body.match(/https:\/\/chordless\.test\/import-setlist#[\w-]+/)?.[0]
  assert.ok(link, body)
  const setlist = await decodeImport(new URL(link).hash)
  assert.deepEqual(
    setlist.songs.map(song => [song.title, song.key, song.ccli]),
    [
      ['Alpha Song', 'G', null],
      ['Brand New Song', 'D', '1234567'],
    ]
  )
  assert.equal(setlist.leader.email, 'one@example.com')
  assert.ok(!body.includes('%PDF'), 'no chart in the reply')
  // The details and the songs are in both versions
  for (const version of [body, html]) {
    assert.match(version, /Sunday 25th October/)
    assert.match(version, /2026-10-25/)
    assert.match(version, /Leader One/)
    assert.match(version, /Alpha Song \(G\)/)
    assert.match(version, /Brand New Song \(D\)/)
  }
  // The long link is behind words, with a short one to see
  assert.match(
    html,
    /<a href="https:\/\/chordless\.test\/import-setlist#[\w-]+"[^>]*>Review and create/
  )
  assert.match(html, />chordless\.test\/import-setlist#…<\/a>/)
})

test('an email with no songs, or no email at all, is answered with why', async () => {
  const none = await answerFor(bytes(email('Hello', [])), 'https://chordless.test')
  assert.match(none.text, /could not find a list of songs/)
  assert.ok(!none.text.includes('import-setlist#') && !none.html.includes('import-setlist#'))
  const broken = await answerFor(new TextEncoder().encode('\u0000\u0001').buffer, 'https://x.test')
  assert.match(broken.text, /could not (find a list of songs|read that email)/)
  assert.ok(!broken.text.includes('import-setlist#'))
})

test('the reply goes to the sender, in reply to their email', async () => {
  const message = fakeIncoming({
    headers: {
      Subject: 'Fwd: Fwd: Sunday 25th October',
      'Message-ID': '<abc@example.com>',
      References: '<one@example.com> <two@example.com>',
    },
  })
  let made: { from: string; to: string; raw: string } | null = null
  await handleEmail(
    message,
    (from, to, raw) => {
      made = { from, to, raw }
      return { from, to }
    },
    'https://chordless.test'
  )
  assert.deepEqual(message.sent, { from: 'import@chordless.test', to: 'sender@example.com' })
  assert.ok(made)
  const text = (made as { raw: string }).raw
  assert.match(text, /^To: sender@example\.com/m)
  assert.match(
    text,
    /^Subject: Re: Sunday 25th October\r?$/m,
    'the conversation it was forwarded from'
  )
  assert.match(text, /^In-Reply-To: <abc@example\.com>/m)
  // Cloudflare's rule: the email's own References, then its Message-ID
  assert.match(text, /^References: <one@example\.com> <two@example\.com> <abc@example\.com>\r?$/m)
  assert.match(text, /^From: Chordless <import@chordless\.test>/m)
})

test('an email that is too big is not read', async () => {
  const message = fakeIncoming({ raw: 'x', rawSize: 100 * 1024 * 1024 })
  await handleEmail(message, () => ({}), 'https://x.test')
  assert.equal(message.replied, false)
})

test('a subject cannot add headers to the reply', () => {
  const text = replyMessage({
    from: 'a@x.test',
    to: 'b@x.test',
    subject: 'Hi\r\nBcc: evil@x.test',
    inReplyTo: null,
    references: null,
    answer: { text: 'é', html: '<p>é</p>' },
  })
  assert.ok(!/^Bcc:/m.test(text))
})

test('an email over a rate limit is dropped with no reply, and a broken limit does not stop one', async () => {
  const make = () => fakeIncoming({ from: 'Sender@Example.com' })
  const keys: string[] = []
  const limit = (success: boolean) => ({
    limit: async ({ key }: { key: string }) => {
      keys.push(key)
      return { success }
    },
  })

  const limited = make()
  await handleEmail(limited, () => ({}), 'https://x.test', { perSender: limit(false) })
  assert.equal(limited.replied, false)
  assert.deepEqual(keys, ['sender@example.com'], 'a sender is one key, whatever its case')

  const overall = make()
  await handleEmail(overall, () => ({}), 'https://x.test', { overall: limit(false) })
  assert.equal(overall.replied, false)

  const fine = make()
  await handleEmail(fine, () => ({}), 'https://x.test', {
    perSender: limit(true),
    overall: limit(true),
  })
  assert.equal(fine.replied, true)

  const broken = make()
  const throws = {
    limit: async () => {
      throw new Error('down')
    },
  }
  await handleEmail(broken, () => ({}), 'https://x.test', { perSender: throws })
  assert.equal(broken.replied, true)
})

test('the reply lists attached charts that are not in the list, songs with no key, and a date to check', async () => {
  const { text, html } = await answerFor(
    bytes(email('Sunday 7th Nov', ['1. Alpha & Co <b> in G', '2. Plain Song'], [PDF])),
    'https://chordless.test'
  )
  assert.match(text, /Date: 2026-11-08 \("Sunday 7th Nov" is a Saturday/)
  assert.match(text, /^1\. Alpha & Co <b> \(G\)$/m)
  assert.match(text, /^2\. Plain Song$/m)
  assert.match(text, /Attached, but not in the list:\n- Brand New Song \(D\)/)
  assert.match(html, /Alpha &#38; Co &#60;b&#62; \(G\)/, 'escaped in the HTML version')
  assert.match(html, /Attached, but not in the list/)
})

test('the reply says so when the email has no name, date or sender', async () => {
  const raw = ['MIME-Version: 1.0', 'Content-Type: text/plain', '', '1. Plain Song'].join('\r\n')
  const { text } = await answerFor(new TextEncoder().encode(raw).buffer, 'https://chordless.test')
  assert.match(text, /Setlist: \(no name\)/)
  assert.match(text, /Date: none found: you will be asked/)
  assert.match(text, /Led by: not found/)
})

test('an email that cannot be read at all is answered with how to import it another way', async () => {
  const log = console.error
  console.error = () => {}
  try {
    // (a buffer that has been handed over cannot be read)
    const gone = new ArrayBuffer(8)
    structuredClone(gone, { transfer: [gone] })
    const { text, html } = await answerFor(gone, 'https://x.test')
    assert.match(text, /could not read that email/)
    assert.match(html, /Could not read that email/)
  } finally {
    console.error = log
  }
})

test('a reply without a conversation to join, or from an address with no domain, is still a message', () => {
  const text = replyMessage({
    from: 'import',
    to: 'b@x.test',
    subject: 'Hi',
    inReplyTo: '<abc@x.test>',
    references: null,
    answer: { text: 'words', html: '<p>words</p>' },
  })
  assert.match(text, /^Message-ID: <[\w-]+@chordless\.app>/m)
  assert.match(text, /^References: <abc@x\.test>\r?$/m)
})
