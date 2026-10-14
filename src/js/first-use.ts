import { getCurrentDB } from './db.ts'
import { hasStoredMusicianType, isSetupDone, markSetupDone } from './preferences.ts'

/**
 * Ask the first-use setup question, once, on whatever page the user arrives at. Someone who has
 * already chosen a musician type, or has songs or setlists (they were here before this question
 * existed), is not asked.
 */
export async function maybeShowFirstUseSetup(): Promise<void> {
  if (isSetupDone()) return
  if (hasStoredMusicianType()) return markSetupDone()
  const db = await getCurrentDB()
  const [songs, setlists] = await Promise.all([db.getAllSongs(), db.getAllSetlists()])
  if (songs.length > 0 || setlists.length > 0) return markSetupDone()

  await import('../components/first-use-setup.ts')
  document.body.append(document.createElement('first-use-setup'))
}
