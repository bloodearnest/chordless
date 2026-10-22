/**
 * First-time Google Auth Handler
 *
 * When a user authenticates with Google for the first time,
 * rename the "Personal" space to their name and switch to it.
 */

import { getCurrentSpace, renameSpace, switchSpace } from './space.ts'

const FIRST_AUTH_KEY = 'first-auth-done'

/**
 * Check if this is the first time user has authenticated
 */
function isFirstAuth(): boolean {
  return !localStorage.getItem(FIRST_AUTH_KEY)
}

/**
 * Mark first auth as complete
 */
function markFirstAuthComplete(): void {
  localStorage.setItem(FIRST_AUTH_KEY, 'true')
}

/**
 * Handle first-time authentication
 * If user has authenticated for the first time and is using "Personal" space,
 * rename it to their name and switch to it
 *
 * @param switchTo - switches to the space, which reloads the page (a test gives its own)
 * @returns True if space was renamed and switched
 */
export async function handleFirstTimeAuth(
  switchTo: (spaceId: string) => Promise<void> = switchSpace
): Promise<boolean> {
  // Check if this is first auth
  if (!isFirstAuth()) {
    return false
  }

  try {
    // Get user info (Google auth loads here, not at start-up, when the user is already set up)
    const { getCurrentUserInfo } = await import('./google-auth.ts')
    const userInfo = await getCurrentUserInfo()
    if (!userInfo?.name) {
      return false
    }

    // Get current space from localStorage (synchronous)
    const { id, name } = getCurrentSpace()
    if (!id) {
      markFirstAuthComplete()
      return false
    }

    // Check if current space is "Personal"
    if (name !== 'Personal') {
      markFirstAuthComplete()
      return false
    }

    // Rename "Personal" to user's name
    const userName = userInfo.name

    await renameSpace(id, userName)

    // Mark as complete
    markFirstAuthComplete()

    // Show notification

    // Switch to the renamed space (will reload the page)
    await switchTo(id)

    return true
  } catch (error) {
    console.error('[FirstAuth] Failed to handle first-time auth:', error)
    // Mark as complete anyway to avoid retrying on error
    markFirstAuthComplete()
    return false
  }
}

/**
 * Rename the space from the pre-sign-in default "Personal" to the Google
 * account's name, if it still has that name. Called before syncing: the Drive
 * folder is found by name on first sync, so syncing as "Personal" and being
 * renamed later would leave this device on a different folder from the others.
 * Unlike handleFirstTimeAuth it doesn't reload the page.
 *
 * @returns True if the space was renamed
 */
export async function nameSpaceBeforeSync(
  space: { id: string | null; name: string } = getCurrentSpace()
): Promise<boolean> {
  const { id, name } = space
  if (!id || name !== 'Personal') {
    return false
  }

  const { getCurrentUserInfo } = await import('./google-auth.ts')
  const userInfo = await getCurrentUserInfo()
  if (!userInfo?.name) {
    return false
  }

  await renameSpace(id, userInfo.name)
  markFirstAuthComplete()
  return true
}

/**
 * Check and handle first-time auth on app startup
 * Call this from your main app initialization
 */
export async function checkFirstTimeAuth(
  switchTo: (spaceId: string) => Promise<void> = switchSpace
): Promise<boolean> {
  if (!isFirstAuth()) {
    return false
  }

  // Check if user is authenticated (will return null if not)
  const { getCurrentUserInfo } = await import('./google-auth.ts')
  const userInfo = await getCurrentUserInfo()

  // If user is authenticated, handle the rename
  if (userInfo?.name) {
    return await handleFirstTimeAuth(switchTo)
  }

  return false
}
