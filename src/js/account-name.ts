/**
 * Asking for their name, once, when they have signed in and have none (docs/ACCOUNT.md, "The account"). A Google sign-in is
 * not guaranteed to say a name, and an emailed code never does, so the person is asked: the question is a modal, answered or
 * left ("Not now"), and asked again at most once a visit. The Account card has the name too, to add or change at any time.
 */
import { cachedAccount, loadAccount } from './account-info.ts'
import { matchRoute } from './router.ts'

const ASKED_KEY = 'chordless:name-asked'

/** Whether they have been asked in this visit */
function askedThisVisit(): boolean {
  try {
    return sessionStorage.getItem(ASKED_KEY) === '1'
  } catch {
    return false
  }
}

/** Ask for the name if they are signed in and have none: not on the join page, where they are in the middle of something */
export async function maybeAskName(): Promise<void> {
  if (askedThisVisit()) return
  const { isAuthenticated, getCurrentUserInfo } = await import('./google-auth.ts')
  if (!(await isAuthenticated())) return
  if (matchRoute(window.location).name === 'join') return
  const account = (await loadAccount()) ?? cachedAccount()
  if (!account || account.name) return
  try {
    sessionStorage.setItem(ASKED_KEY, '1')
  } catch {
    // (storage is blocked: they may be asked again on the next page)
  }
  await import('../components/name-prompt.ts')
  const prompt = document.createElement('name-prompt')
  // (what their sign-in said, to start from: they may change it)
  prompt.suggested = (await getCurrentUserInfo())?.name ?? ''
  document.body.append(prompt)
}
