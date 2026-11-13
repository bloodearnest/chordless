/**
 * Lead sheets that the device's other spaces hold for songs this space has (docs/LEAD_SHEETS.md, "In
 * a Team"). A sheet belongs to a song of one space: a Team made from a Personal space's export got
 * the charts and none of the sheets, and a Team's Drive never had any. They can be copied across
 * from the other spaces' own copies, on this device, with no Drive access to the source.
 *
 * The same chart in another space is found by its content, else by its song's id (`ccli-7226112`),
 * as the uuids differ from space to space. A song that has a sheet keeps it.
 */
import { withSource } from './other-songs.ts'
import { databaseExists } from './share-receiver.ts'
import { listSpaces } from './space.ts'
import { copyScores, emptyReport, matchSongs, scoresToCopy } from './space-transfer.ts'

/** The other spaces of the device that have a database, the Personal ones first (the sheets began there) */
async function otherSpaces(spaceId: string): Promise<string[]> {
  const spaces = (await listSpaces()).filter(space => space.id !== spaceId)
  const here: string[] = []
  for (const space of [...spaces].sort(
    (a, b) => Number(Boolean(a.team)) - Number(Boolean(b.team))
  )) {
    if (await databaseExists(space.id)) here.push(space.id)
  }
  return here
}

/** How many of this space's songs lack a lead sheet that another space of the device has */
export function sheetsToCopyInto(spaceId: string): Promise<number> {
  return withSource(spaceId, async destination => {
    const taken = new Set<string>()
    for (const otherId of await otherSpaces(spaceId)) {
      await withSource(otherId, async source => {
        await scoresToCopy(source, destination, await matchSongs(source, destination), taken)
      })
    }
    return taken.size
  })
}

/**
 * Copy those lead sheets into this space, which syncs them to its Drive as it does its other changes.
 * @returns how many songs got one
 */
export function copySheetsInto(spaceId: string): Promise<number> {
  return withSource(spaceId, async destination => {
    const report = emptyReport()
    for (const otherId of await otherSpaces(spaceId)) {
      await withSource(otherId, async source => {
        await copyScores(source, destination, await matchSongs(source, destination), report)
      })
    }
    return report.scoresAdded
  })
}
