// Gets the refresh token for the real-Drive suite (docs/DRIVE_TESTS.md): `just drive-test-login`.
// Sign in as the TEST Google account in the browser that opens; the token is written to
// .drive-test.env (readable by you only) and never printed.
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import {
  CREDENTIAL_VARIABLES,
  consentUrl,
  credentialsFromEnv,
  withRefreshToken,
} from '../tests/drive/node-side.ts'

const ENV_FILE = '.drive-test.env'

const found = credentialsFromEnv({ ...process.env, [CREDENTIAL_VARIABLES.refreshToken]: 'later' })
if ('missing' in found) {
  console.error(`Put ${found.missing.join(' and ')} in ${ENV_FILE} first (docs/DRIVE_TESTS.md).`)
  process.exit(1)
}
const { clientId, clientSecret } = found.credentials

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
  const text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : ''
  writeFileSync(ENV_FILE, withRefreshToken(text, body.refresh_token), { mode: 0o600 })
  chmodSync(ENV_FILE, 0o600)
  response.writeHead(200).end('Done: you can close this tab.')
  console.log(`Saved ${CREDENTIAL_VARIABLES.refreshToken} in ${ENV_FILE}.`)
  server.close()
})

server.listen(0, '127.0.0.1', () => {
  const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  console.log('Open this address, signed in as the TEST account, and allow access:\n')
  console.log(
    consentUrl({
      clientId,
      redirectUri,
      state,
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    })
  )
})
