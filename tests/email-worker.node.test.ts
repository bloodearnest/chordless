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

test('an email with a list of songs is answered with a link that holds them', async () => {
  const { subject, body } = await answerFor(
    bytes(email('Sunday 25th October', ['1. Alpha Song in G', '2. Brand New Song in D'], [PDF])),
    'https://chordless.test'
  )
  assert.match(subject, /Sunday 25th October/)
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
})

test('an email with no songs, or no email at all, is answered with why', async () => {
  const none = await answerFor(bytes(email('Hello', [])), 'https://chordless.test')
  assert.match(none.subject, /No songs/)
  assert.ok(!none.body.includes('import-setlist#'))
  const broken = await answerFor(new TextEncoder().encode('\u0000\u0001').buffer, 'https://x.test')
  assert.ok(broken.subject)
  assert.ok(!broken.body.includes('import-setlist#'))
})

test('the reply goes to the sender, in reply to their email', async () => {
  const raw = email('Sunday 25th October', ['1. Alpha Song in G'])
  let sent: unknown
  const message: IncomingEmail = {
    from: 'sender@example.com',
    to: 'import@chordless.test',
    rawSize: raw.length,
    raw: new Response(raw).body as ReadableStream<Uint8Array>,
    headers: { get: name => (name === 'Message-ID' ? '<abc@example.com>' : null) },
    reply: async reply => {
      sent = reply
    },
  }
  let made: { from: string; to: string; raw: string } | null = null
  await handleEmail(
    message,
    (from, to, raw) => {
      made = { from, to, raw }
      return { from, to }
    },
    'https://chordless.test'
  )
  assert.deepEqual(sent, { from: 'import@chordless.test', to: 'sender@example.com' })
  assert.ok(made)
  const text = (made as { raw: string }).raw
  assert.match(text, /^To: sender@example\.com/m)
  assert.match(text, /^In-Reply-To: <abc@example\.com>/m)
  assert.match(text, /^From: Chordless <import@chordless\.test>/m)
})

test('an email that is too big is not read', async () => {
  let replied = false
  await handleEmail(
    {
      from: 'a@example.com',
      to: 'b@example.com',
      rawSize: 100 * 1024 * 1024,
      raw: new Response('x').body as ReadableStream<Uint8Array>,
      headers: { get: () => null },
      reply: async () => {
        replied = true
      },
    },
    () => ({}),
    'https://x.test'
  )
  assert.equal(replied, false)
})

test('a subject cannot add headers to the reply', () => {
  const text = replyMessage({
    from: 'a@x.test',
    to: 'b@x.test',
    subject: 'Hi\r\nBcc: evil@x.test',
    inReplyTo: null,
    body: 'é',
  })
  assert.ok(!/^Bcc:/m.test(text))
})
