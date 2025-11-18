/**
 * First-time Google Auth Handler
 *
 * When a user authenticates with Google for the first time,
 * rename the "Personal" organisation to their name and switch to it.
 */

import { getCurrentUserInfo } from './google-auth.js';
import { getCurrentOrganisation, renameOrganisation, switchOrganisation } from './organisation.js';

const FIRST_AUTH_KEY = 'setalight-first-auth-done';

/**
 * Check if this is the first time user has authenticated
 * @returns {boolean}
 */
function isFirstAuth() {
  return !localStorage.getItem(FIRST_AUTH_KEY);
}

/**
 * Mark first auth as complete
 */
function markFirstAuthComplete() {
  localStorage.setItem(FIRST_AUTH_KEY, 'true');
}

/**
 * Handle first-time authentication
 * If user has authenticated for the first time and is using "Personal" org,
 * rename it to their name and switch to it
 *
 * @returns {Promise<boolean>} True if org was renamed and switched
 */
export async function handleFirstTimeAuth() {
  // Check if this is first auth
  if (!isFirstAuth()) {
    return false;
  }

  try {
    // Get user info
    const userInfo = await getCurrentUserInfo();
    if (!userInfo || !userInfo.name) {
      console.log('[FirstAuth] No user info available, skipping org rename');
      return false;
    }

    // Get current org from localStorage (synchronous)
    const { id, name } = getCurrentOrganisation();
    if (!id) {
      console.log('[FirstAuth] No current org found, skipping rename');
      markFirstAuthComplete();
      return false;
    }

    // Check if current org is "Personal"
    if (name !== 'Personal') {
      console.log('[FirstAuth] Current org is not "Personal", skipping rename');
      markFirstAuthComplete();
      return false;
    }

    // Rename "Personal" to user's name
    const userName = userInfo.name;
    console.log(`[FirstAuth] Renaming "Personal" to "${userName}"`);

    await renameOrganisation(id, userName);

    // Mark as complete
    markFirstAuthComplete();

    // Show notification
    console.log(`[FirstAuth] ✅ Welcome ${userName}! Your personal workspace has been set up.`);

    // Switch to the renamed org (will reload the page)
    await switchOrganisation(id);

    return true;
  } catch (error) {
    console.error('[FirstAuth] Failed to handle first-time auth:', error);
    // Mark as complete anyway to avoid retrying on error
    markFirstAuthComplete();
    return false;
  }
}

/**
 * Check and handle first-time auth on app startup
 * Call this from your main app initialization
 */
export async function checkFirstTimeAuth() {
  if (!isFirstAuth()) {
    return false;
  }

  // Check if user is authenticated (will return null if not)
  const userInfo = await getCurrentUserInfo();

  // If user is authenticated, handle the rename
  if (userInfo && userInfo.name) {
    return await handleFirstTimeAuth();
  }

  return false;
}
