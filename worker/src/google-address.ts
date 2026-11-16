/**
 * Whether an email address looks like a Google account's, so the page that welcomes an invitee can say
 * what to do (docs/SPACES.md, "Setting up and joining a team space"). Only public facts are used:
 *
 * - `gmail`: a gmail.com or googlemail.com address, which certainly is one.
 * - `workspace`: the domain's mail is hosted by Google (an MX record under google.com or
 *   googlemail.com), so its accounts are almost certainly Google Workspace ones.
 * - `other`: anything else. It *might* be a Google account (someone can make one on any address), and
 *   nothing public says; probing Google's sign-in to find out is not something Chordless does.
 * - `unknown`: the lookup failed or timed out, so nothing is said.
 *
 * The lookup is DNS over HTTPS to Cloudflare's resolver, from the Worker, because the page's policy
 * allows only its own origin. Nothing is stored, and the address is never sent anywhere but as the domain
 * of a DNS question.
 */
export type GoogleKind = 'gmail' | 'workspace' | 'other' | 'unknown'

const GMAIL = /@(gmail|googlemail)\.com$/i
const GOOGLE_MAIL = /(^|\.)(google|googlemail)\.com\.?$/i
/** What a domain looks like when it can be asked about (anything else is not looked up) */
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i
const RESOLVER = 'https://cloudflare-dns.com/dns-query'
const MX = 15
const TIMEOUT_MS = 2000

interface DnsAnswer {
  Status?: number
  Answer?: { type?: number; data?: string }[]
}

/** The kind of address this is, and how long the DNS question took (0 when none was asked) */
export async function googleKind(
  email: string,
  ask: typeof fetch = fetch
): Promise<{ kind: GoogleKind; ms: number }> {
  if (GMAIL.test(email.trim())) return { kind: 'gmail', ms: 0 }
  const domain = email
    .trim()
    .slice(email.lastIndexOf('@') + 1)
    .toLowerCase()
  if (!DOMAIN.test(domain)) return { kind: 'other', ms: 0 }
  const started = Date.now()
  try {
    const response = await ask(`${RESOLVER}?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const ms = Date.now() - started
    if (!response.ok) return { kind: 'unknown', ms }
    const answer = (await response.json()) as DnsAnswer
    const hosts = (answer.Answer ?? [])
      .filter(record => record.type === MX && typeof record.data === 'string')
      .map(record => (record.data as string).trim().split(/\s+/).at(-1) as string)
    return { kind: hosts.some(host => GOOGLE_MAIL.test(host)) ? 'workspace' : 'other', ms }
  } catch {
    return { kind: 'unknown', ms: Date.now() - started }
  }
}
