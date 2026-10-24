// Sets up the real-Drive suite's credentials (docs/DRIVE_TESTS.md): `just drive-test-login`.
// Takes the DEV project's OAuth client from .dev.vars (only when it is the dev client of
// .env.development, so production's values are never used), or else from .drive-test.env, or asks
// (the secret is not shown as you type); opens Google's sign-in for the test account, and writes the
// client and the refresh token it gives back to .drive-test.env (readable by you only). Nothing
// secret is printed.
//
// Google does not take an account's password from a script: it is typed on Google's own page.
import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { CREDENTIAL_VARIABLES, consentUrl, withEnvVariable } from '../tests/drive/node-side.ts'
import { ask } from './ask.ts'
import { devClient, parseVars } from './dev-vars-lib.ts'

const ENV_FILE = '.drive-test.env'
const ACCOUNT_VARIABLE = 'DRIVE_TEST_ACCOUNT'
const DEFAULT_ACCOUNT = 'chordless.test.user@gmail.com'

const read = () => (existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '')
function keep(name: string, value: string) {
  writeFileSync(ENV_FILE, withEnvVariable(read(), name, value), { mode: 0o600 })
  chmodSync(ENV_FILE, 0o600)
}

const env = (name: string) => process.env[name] || undefined

const readVars = (file: string) => (existsSync(file) ? parseVars(readFileSync(file, 'utf8')) : {})
const fromDevVars = devClient(
  readVars('.dev.vars'),
  readVars('.env.development').VITE_GOOGLE_CLIENT_ID
)
if (fromDevVars) {
  keep(CREDENTIAL_VARIABLES.clientId, fromDevVars.id)
  keep(CREDENTIAL_VARIABLES.clientSecret, fromDevVars.secret)
  console.log("Using the dev client from .dev.vars (the same one 'npm run dev' signs in with).")
}
const clientId =
  fromDevVars?.id ??
  env(CREDENTIAL_VARIABLES.clientId) ??
  (await ask('OAuth client id (the test client): '))
if (!fromDevVars && !env(CREDENTIAL_VARIABLES.clientId))
  keep(CREDENTIAL_VARIABLES.clientId, clientId)
const clientSecret =
  fromDevVars?.secret ??
  env(CREDENTIAL_VARIABLES.clientSecret) ??
  (await ask('OAuth client secret (not shown): ', { hidden: true }))
if (!fromDevVars && !env(CREDENTIAL_VARIABLES.clientSecret))
  keep(CREDENTIAL_VARIABLES.clientSecret, clientSecret)
if (!clientId || !clientSecret) {
  console.error('Both the client id and its secret are needed.')
  process.exit(1)
}
const account = env(ACCOUNT_VARIABLE) ?? DEFAULT_ACCOUNT
if (!env(ACCOUNT_VARIABLE)) keep(ACCOUNT_VARIABLE, account)

const verifier = randomBytes(32).toString('base64url')
const state = randomBytes(16).toString('base64url')

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const code = url.searchParams.get('code')
  if (url.searchParams.get('state') !== state || !code) {
    response.writeHead(400).end('Not the answer to this login.')
    return
  }
  const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const reply = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  })
  const body = (await reply.json()) as { refresh_token?: string; error_description?: string }
  if (!body.refresh_token) {
    response.writeHead(500).end('Google sent no refresh token.')
    console.error(`Google sent no refresh token: ${body.error_description ?? reply.status}`)
    process.exit(1)
  }
  keep(CREDENTIAL_VARIABLES.refreshToken, body.refresh_token)
  response.writeHead(200).end('Done: you can close this tab.')
  console.log(`Saved ${CREDENTIAL_VARIABLES.refreshToken} in ${ENV_FILE}.`)
  server.close()
})

// (a web client only takes redirect addresses registered on it: register http://127.0.0.1:PORT)
const PORT = Number(env('DRIVE_TEST_LOGIN_PORT') ?? 8976)

server.listen(PORT, '127.0.0.1', () => {
  const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const address = consentUrl({
    clientId,
    redirectUri,
    state,
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    loginHint: account,
  })
  console.log(`Sign in as ${account} and allow access. If the browser does not open, use:\n`)
  console.log(address)
  // (best effort: where there is no opener, the address above is enough)
  execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [address], () => undefined)
})
