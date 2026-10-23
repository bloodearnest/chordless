import { getCurrentDB } from './db.ts'
import { hasStoredMusicianType, isSetupDone, markSetupDone } from './preferences.ts'
import { matchRoute } from './router.ts'
import { hasCurrentSpace } from './space.ts'

/**
 * Ask the first-use setup question, once, on whatever page the user arrives at. Someone who has
 * already chosen a musician type, or has songs or setlists (they were here before this question
 * existed), is not asked.
 */
export async function maybeShowFirstUseSetup(): Promise<void> {
  if (isSetupDone()) return
  // Someone whose first contact is an invite has no space yet, and must not be given a Personal
  // one by this: they are asked once they are in the team (or on a later page, if the join fails)
  if (!hasCurrentSpace() && matchRoute(window.location).name === 'join') return
  if (hasStoredMusicianType()) return markSetupDone()
  const db = await getCurrentDB()
  const [songs, setlists] = await Promise.all([db.getAllSongs(), db.getAllSetlists()])
  if (songs.length > 0 || setlists.length > 0) return markSetupDone()

  await import('../components/first-use-setup.ts')
  document.body.append(document.createElement('first-use-setup'))
}
