/**
 * The script that downloads emails from Gmail (scripts/gmail-download.ts), against a fake Gmail.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildQuery, countPdfs, downloadEmails, type GmailPart } from '../scripts/gmail-download.ts'

const pdf = (filename: string): GmailPart => ({ mimeType: 'application/pdf', filename })
const text: GmailPart = { mimeType: 'text/plain', filename: '' }

test('the search names the senders, PDFs, and the date', () => {
  assert.equal(buildQuery(['a@x.com']), 'from:a@x.com has:attachment filename:pdf')
  assert.equal(
    buildQuery(['a@x.com', 'b@x.com'], '2025/01/01'),
    'from:(a@x.com OR b@x.com) has:attachment filename:pdf after:2025/01/01'
  )
})

test('PDFs are counted by type or by name, including inside an attached message', () => {
  const nested: GmailPart = { mimeType: 'message/rfc822', parts: [pdf('c.pdf'), text] }
  assert.equal(
    countPdfs({
      mimeType: 'multipart/mixed',
      parts: [
        text,
        pdf('a.pdf'),
        { mimeType: 'application/octet-stream', filename: 'B.PDF' },
        nested,
      ],
    }),
    3
  )
  assert.equal(
    countPdfs({ mimeType: 'application/pdf', filename: '' }),
    0,
    'an inline part with no name'
  )
  assert.equal(countPdfs({ mimeType: 'image/png', filename: 'a.png' }), 0)
})

/** A Gmail with these messages: id, when, and PDFs attached */
function fakeGmail(messages: Record<string, { date: string; pdfs: number; raw: string }>) {
  const requests: string[] = []
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    requests.push(url.pathname + url.search)
    const headers = new Headers(init?.headers)
    if (headers.get('Authorization') !== 'Bearer good-token')
      return new Response('no', { status: 401 })
    const json = (body: unknown) => new Response(JSON.stringify(body))
    if (url.pathname.endsWith('/messages')) {
      return json({ messages: Object.keys(messages).map(id => ({ id })) })
    }
    const id = url.pathname.split('/').pop() as string
    const message = messages[id]
    if (!message) return new Response('missing', { status: 404 })
    if (url.searchParams.get('format') === 'raw') {
      return json({ raw: Buffer.from(message.raw).toString('base64url') })
    }
    return json({
      internalDate: String(Date.parse(message.date)),
      payload: {
        mimeType: 'multipart/mixed',
        parts: Array.from({ length: message.pdfs }, (_, i) => pdf(`${i}.pdf`)),
      },
    })
  }) as typeof fetch
  return { fetcher, requests }
}

const withDir = async (run: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), 'download-emails-'))
  try {
    await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const gmail = () =>
  fakeGmail({
    aaa: { date: '2026-10-09T18:11:00Z', pdfs: 8, raw: 'From: a\r\n\r\nbig set' },
    bbb: { date: '2026-10-02T10:00:00Z', pdfs: 2, raw: 'two only' },
    ccc: { date: '2026-09-20T10:00:00Z', pdfs: 3, raw: 'exactly three' },
  })

test('emails with enough PDFs are saved whole, named by date and id; the rest are not', async () => {
  const { fetcher } = gmail()
  await withDir(async dir => {
    const result = await downloadEmails({
      token: 'good-token',
      senders: ['a@x.com'],
      minPdfs: 3,
      outDir: join(dir, 'out'),
      fetch: fetcher,
      log: () => {},
    })
    assert.deepEqual(readdirSync(join(dir, 'out')).sort(), [
      '2026-09-20-ccc.eml',
      '2026-10-09-aaa.eml',
    ])
    assert.equal(
      readFileSync(join(dir, 'out', '2026-10-09-aaa.eml'), 'utf8'),
      'From: a\r\n\r\nbig set'
    )
    assert.equal(result.found, 3)
    assert.equal(result.matching, 2)
  })
})

test('running again skips what is saved already', async () => {
  const { fetcher, requests } = gmail()
  await withDir(async dir => {
    const options = {
      token: 'good-token',
      senders: ['a@x.com'],
      minPdfs: 3,
      outDir: dir,
      fetch: fetcher,
      log: () => {},
    }
    await downloadEmails(options)
    const before = requests.filter(r => r.includes('format=raw')).length
    const again = await downloadEmails(options)
    assert.deepEqual(again.saved, [])
    assert.equal(again.already, 2)
    assert.equal(
      requests.filter(r => r.includes('format=raw')).length,
      before,
      'nothing fetched twice'
    )
  })
})

test('a dry run saves nothing', async () => {
  const { fetcher, requests } = gmail()
  await withDir(async dir => {
    const out = join(dir, 'out')
    const result = await downloadEmails({
      token: 'good-token',
      senders: ['a@x.com'],
      minPdfs: 3,
      outDir: out,
      dryRun: true,
      fetch: fetcher,
      log: () => {},
    })
    assert.equal(result.saved.length, 2)
    assert.equal(existsSync(out), false)
    assert.ok(!requests.some(r => r.includes('format=raw')))
  })
})

test('a bad token says to get a new one', async () => {
  const { fetcher } = gmail()
  await withDir(async dir => {
    writeFileSync(join(dir, 'x'), '')
    await assert.rejects(
      downloadEmails({
        token: 'old',
        senders: ['a@x.com'],
        minPdfs: 3,
        outDir: dir,
        fetch: fetcher,
        log: () => {},
      }),
      /get a new one/
    )
  })
})

test('no senders is an error, not a search of everything', async () => {
  await assert.rejects(
    downloadEmails({ token: 't', senders: [], minPdfs: 3, outDir: 'x', log: () => {} }),
    /No senders/
  )
})
