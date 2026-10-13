/**
 * Downloading emails from Gmail as .eml files: the library of scripts/download-emails.ts, apart
 * from it so tests can run it against a fake Gmail (it takes `fetch`).
 *
 * It finds the emails from some senders that have PDFs attached, keeps those with at least
 * `minPdfs`, and saves each one whole (headers, body, attachments) as <date>-<id>.eml. It only
 * reads: the token needs only the gmail.readonly scope.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export interface DownloadOptions {
  /** An OAuth access token with the gmail.readonly scope */
  token: string
  /** Addresses to take mail from */
  senders: string[]
  /** Keep emails with at least this many PDFs attached */
  minPdfs: number
  outDir: string
  /** Only emails after this date, as YYYY/MM/DD */
  after?: string
  /** Stop after this many emails have been found by the search */
  max?: number
  /** Say what would be saved, but save nothing */
  dryRun?: boolean
  fetch?: typeof fetch
  log?: (message: string) => void
}

/** The parts of a Gmail message resource that are read */
export interface GmailPart {
  mimeType?: string
  filename?: string
  parts?: GmailPart[]
}

/** Gmail's search for the emails to look at */
export function buildQuery(senders: string[], after?: string): string {
  const from = senders.length === 1 ? `from:${senders[0]}` : `from:(${senders.join(' OR ')})`
  return [from, 'has:attachment', 'filename:pdf', after ? `after:${after}` : '']
    .filter(Boolean)
    .join(' ')
}

/** How many PDFs a message carries, including ones inside a message attached to it */
export function countPdfs(part: GmailPart): number {
  const isPdf =
    Boolean(part.filename) &&
    (part.mimeType === 'application/pdf' || /\.pdf$/i.test(part.filename ?? ''))
  return (isPdf ? 1 : 0) + (part.parts ?? []).reduce((sum, child) => sum + countPdfs(child), 0)
}

/** Gmail's base64url, as bytes */
export const fromBase64Url = (text: string) => Buffer.from(text, 'base64url')

class GmailError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** A GET of the Gmail API, as JSON, trying again a few times when told to slow down */
async function get<T>(options: DownloadOptions, path: string): Promise<T> {
  const doFetch = options.fetch ?? fetch
  for (let attempt = 0; ; attempt++) {
    const response = await doFetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${options.token}` },
    })
    if (response.ok) return (await response.json()) as T
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
      continue
    }
    const detail = await response.text().catch(() => '')
    if (response.status === 401) {
      throw new GmailError(401, 'Gmail refused the token. They last an hour: get a new one.')
    }
    throw new GmailError(
      response.status,
      `Gmail ${response.status} for ${path.split('?')[0]}: ${detail.slice(0, 300)}`
    )
  }
}

/** The ids of the emails the search finds, newest first */
async function search(options: DownloadOptions, query: string): Promise<string[]> {
  const ids: string[] = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ q: query, maxResults: '500' })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await get<{ messages?: { id: string }[]; nextPageToken?: string }>(
      options,
      `/messages?${params}`
    )
    ids.push(...(page.messages ?? []).map(message => message.id))
    pageToken = page.nextPageToken ?? ''
  } while (pageToken && ids.length < (options.max ?? Number.POSITIVE_INFINITY))
  return ids.slice(0, options.max)
}

export interface DownloadResult {
  /** Emails the search found */
  found: number
  /** Of those, with enough PDFs */
  matching: number
  /** Saved now (or that would be, on a dry run) */
  saved: string[]
  /** Already in the folder */
  already: number
}

export async function downloadEmails(options: DownloadOptions): Promise<DownloadResult> {
  const log = options.log ?? console.log
  if (!options.senders.length) throw new Error('No senders given')
  if (!options.dryRun) mkdirSync(options.outDir, { recursive: true })
  const have = existsSync(options.outDir) ? readdirSync(options.outDir) : []
  const haveId = (id: string) => have.some(name => name.endsWith(`-${id}.eml`))

  const ids = await search(options, buildQuery(options.senders, options.after))
  log(`${ids.length} emails from those senders have a PDF attached`)
  const result: DownloadResult = { found: ids.length, matching: 0, saved: [], already: 0 }

  for (const [index, id] of ids.entries()) {
    const message = await get<{ internalDate: string; payload: GmailPart }>(
      options,
      `/messages/${id}?format=full`
    )
    const pdfs = countPdfs(message.payload)
    if (pdfs < options.minPdfs) continue
    result.matching++
    if (haveId(id)) {
      result.already++
      continue
    }
    const name = `${new Date(Number(message.internalDate)).toISOString().slice(0, 10)}-${id}.eml`
    if (!options.dryRun) {
      const { raw } = await get<{ raw: string }>(options, `/messages/${id}?format=raw`)
      writeFileSync(join(options.outDir, name), fromBase64Url(raw))
    }
    result.saved.push(name)
    log(
      `${options.dryRun ? 'would save' : 'saved'} ${name} (${pdfs} PDFs) [${index + 1}/${ids.length}]`
    )
  }
  log(
    `${result.matching} have at least ${options.minPdfs} PDFs: ${result.saved.length} ${options.dryRun ? 'to save' : 'saved'}, ${result.already} already in ${options.outDir}`
  )
  return result
}
