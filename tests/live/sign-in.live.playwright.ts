import { expect, test } from '@playwright/test'
import { liveEnvironment, signIn } from './signed-in.ts'

const found = liveEnvironment()
test.skip('missing' in found, `needs ${'missing' in found ? found.missing.join(', ') : ''}`)

test('a browser signed in as the test account gets a Drive access token from the real Worker', async ({
  page,
}) => {
  await signIn(page)
  const result = await page.evaluate(async () => {
    const auth = await import('/js/google-auth.ts')
    const state = await auth.getSignInState()
    const token = state === 'signed-in' ? await auth.getAccessToken() : ''
    return { state, tokenLength: token.length, user: (await auth.getCurrentUserInfo())?.email }
  })
  expect(result.state).toBe('signed-in')
  expect(result.tokenLength).toBeGreaterThan(20)
  expect(result.user).toBe(process.env.DRIVE_TEST_ACCOUNT)
})
