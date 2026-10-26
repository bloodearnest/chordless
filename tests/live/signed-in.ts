/**
 * Browsers that are signed in as the test Google account, without Google's consent screen
 * (docs/DRIVE_TESTS.md): the app keeps a sign-in as an encrypted blob that holds the account's refresh
 * token, which the Worker opens with its key. So one is made here, with the key in .dev.vars and the
 * refresh token the Drive suite's login left in .drive-test.env, and put where the app keeps it. The
 * app then asks the real Worker for access tokens, which asks Google, as it would after a real sign-in.
 */
import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { encryptBlob } from '../../worker/src/blob.ts'

const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email profile'

/** What the tests need of the environment, or why they cannot run (the names of what is missing) */
export function liveEnvironment(env: Record<string, string | undefined> = process.env) {
  const names = ['DRIVE_TEST_REFRESH_TOKEN', 'DRIVE_TEST_ACCOUNT', 'JWE_ENCRYPTION_KEY']
  const missing = names.filter(name => !env[name])
  return missing.length > 0
    ? { missing }
    : {
        refreshToken: env.DRIVE_TEST_REFRESH_TOKEN as string,
        account: env.DRIVE_TEST_ACCOUNT as string,
        encryptionKey: env.JWE_ENCRYPTION_KEY as string,
      }
}

/** Sign this page's browser in as the test account: the blob, kept where the app keeps its sign-in */
export async function signIn(page: Page): Promise<void> {
  const found = liveEnvironment()
  if ('missing' in found) throw new Error(`needs ${found.missing.join(', ')}`)

  const blob = await encryptBlob(
    {
      owner_email: found.account,
      owner_sub: undefined,
      scopes: SCOPES,
      refresh_token: found.refreshToken,
      created_at: new Date().toISOString(),
      blob_id: randomUUID(),
      kid: 'default',
    },
    { JWE_ENCRYPTION_KEY: found.encryptionKey }
  )

  await page.goto('/')
  // (the service worker keeps the sign-in: it has to be in charge of the page)
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 30_000,
  })
  await page.evaluate(
    async ({ blob, account, scope }) => {
      const auth = await import('/js/google-auth.ts')
      // (no access token yet: the first call for one makes the Worker ask Google for it)
      await auth.storeSignIn(blob, {
        scope,
        user: {
          name: 'Chordless Test',
          email: account,
          picture: null,
          given_name: 'Chordless',
          family_name: 'Test',
          sub: null,
        },
      })
    },
    { blob, account: found.account, scope: SCOPES }
  )
}
