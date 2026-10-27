/**
 * The Worker's secrets, declared once: what each is for, whether it is needed, and what a good
 * value looks like. The Worker checks them as it starts (`misconfigured`), so a missing or mangled
 * one is said at the first request, by name, and not found as an odd failure later. The names are
 * also listed in `wrangler.toml` and `.dev.vars.example`; `tests/config.node.test.ts` checks the
 * three agree (docs/ENVIRONMENTS.md).
 */
import type { Env } from './env.ts'

export interface SecretSpec {
  name: keyof Env & string
  /** Without it the Worker cannot do its job (the rest turn one feature off) */
  required: boolean
  about: string
  /** What is wrong with a value that is set, or null; never repeats the value */
  problem(value: string): string | null
}

const base64Bytes = (value: string) => {
  try {
    return atob(value).length
  } catch {
    return -1
  }
}

export const SECRETS: SecretSpec[] = [
  {
    name: 'JWE_ENCRYPTION_KEY',
    required: true,
    about: 'Base64 AES-256 key for the token blobs',
    problem: value => (base64Bytes(value) === 32 ? null : 'is not 32 bytes of base64'),
  },
  {
    name: 'GOOGLE_CLIENT_ID',
    required: true,
    about:
      "The Google OAuth client's id: the one the page signs in with (.env.production / .env.development)",
    problem: value =>
      /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(value)
        ? null
        : 'is not a Google OAuth client id',
  },
  {
    name: 'GOOGLE_CLIENT_SECRET',
    required: true,
    about: "The Google OAuth client's secret",
    problem: value =>
      value.trim() === value && value.length >= 10 ? null : 'looks wrong (blank, short or padded)',
  },
  {
    name: 'GOOGLE_API_KEY',
    required: true,
    about: 'Key restricted to the Drive API, for share link downloads',
    problem: value => (/^AIza[\w-]{30,}$/.test(value) ? null : 'is not a Google API key'),
  },
  {
    name: 'PICKER_API_KEY',
    required: false,
    about:
      'Browser key restricted to the Picker API and our addresses, for the team space folder picker',
    problem: value => (/^AIza[\w-]{30,}$/.test(value) ? null : 'is not a Google API key'),
  },
  {
    name: 'OTLP_HEADERS',
    required: false,
    about:
      "Headers for the page's traces sent to Honeycomb, `x-honeycomb-team=<ingest key>` (docs/OBSERVABILITY.md); without it they are dropped",
    problem: value =>
      value.split(',').every(pair => /^[\w-]+=\S+$/.test(pair.trim()))
        ? null
        : 'is not name=value pairs, separated by commas',
  },
]

/** What is wrong with the Worker's configuration, by secret name (none when all is well) */
export function configProblems(env: object): string[] {
  const problems: string[] = []
  for (const secret of SECRETS) {
    const value = (env as Record<string, unknown>)[secret.name]
    if (value === undefined || value === '') {
      if (secret.required) problems.push(`${secret.name} is not set (${secret.about})`)
    } else if (typeof value !== 'string') {
      problems.push(`${secret.name} is not a string`)
    } else {
      const problem = secret.problem(value)
      if (problem) problems.push(`${secret.name} ${problem}`)
    }
  }
  return problems
}

/** The paths the Worker answers itself (wrangler.toml run_worker_first): the rest is the page's files */
const WORKER_PATHS = /^\/(oauth|session|api|s)\//

let said = false

/**
 * An error to answer with when the configuration is wrong, for the requests that need it; null
 * when all is well (or the request is for a file of the page). Logs the problems once. The
 * development Worker (`DEV_PAGES`, set only in [env.dev]) logs them and carries on: it runs with
 * whatever .dev.vars the developer has, and the tests with none that are real.
 */
export function misconfigured(request: Request, env: object): Response | null {
  if (!WORKER_PATHS.test(new URL(request.url).pathname)) return null
  const problems = configProblems(env)
  if (problems.length === 0) return null
  if (!said) {
    said = true
    console.error(`[config] The Worker is not set up: ${problems.join('; ')}`)
  }
  if ((env as { DEV_PAGES?: string }).DEV_PAGES) return null
  return Response.json({ error: 'server_misconfigured', problems }, { status: 500 })
}
