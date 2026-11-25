/**
 * Moving a Personal space from Google Drive to Chordless's server (docs/CENTRAL_STORAGE.md, step 5): once, and for good. The
 * server gets the space's songs and setlists; Drive is never synced again (the space is marked `server`), though its
 * files stay where they are until the person deletes them. Pad audio is not moved (it is added again when pads are
 * kept on the server). A space whose account already has songs or setlists on the server moves only when asked to
 * combine: the two are merged (songs by their identity, setlists by theirs; what the two disagree about is settled
 * as any other conflict is), and nothing on the server is removed.
 */
import { callWorker, type WorkerConnection } from './worker-call.ts'

/** The account already has songs or setlists on the server: nothing is moved, and nothing was changed */
export class ServerHasDataError extends Error {
  constructor() {
    super('Your Chordless account already has songs or setlists')
    this.name = 'ServerHasDataError'
  }
}

export interface MoveSteps {
  /** The account's personal library, made if it has none: its id */
  makeLibrary(): Promise<string>
  /** Whether that library or the account's setlists already hold anything */
  serverHasData(libraryId: string): Promise<boolean>
  /** Queue the space's setlists to be created there, before anything is read from it */
  seed(): Promise<void>
  /** The space is the server's from now on */
  mark(libraryId: string, movedAt: string): Promise<void>
  /** Send it all, songs first */
  sync(): Promise<void>
  now(): string
}

/** @returns the personal library's id */
export async function moveToServer(steps: MoveSteps, combine = false): Promise<string> {
  const libraryId = await steps.makeLibrary()
  if (!combine && (await steps.serverHasData(libraryId))) throw new ServerHasDataError()
  await steps.seed()
  await steps.mark(libraryId, steps.now())
  await steps.sync()
  return libraryId
}

/** The server's side of the steps, for a person's connection */
export function serverSteps(
  connection: WorkerConnection
): Pick<MoveSteps, 'makeLibrary' | 'serverHasData'> {
  return {
    async makeLibrary() {
      const response = await callWorker({ method: 'PUT', path: '/api/account/library' }, connection)
      const { libraryId } = (await response.json()) as { libraryId?: string }
      if (!libraryId) throw new Error('The server did not name a library')
      return libraryId
    },
    async serverHasData(libraryId) {
      const [songs, setlists] = await Promise.all([
        callWorker({ path: `/api/libraries/${encodeURIComponent(libraryId)}/songs` }, connection),
        callWorker({ path: '/api/account/setlists' }, connection),
      ])
      const held = (await songs.json()) as { songs?: unknown[] }
      const sets = (await setlists.json()) as { setlists?: unknown[] }
      return Boolean(held.songs?.length || sets.setlists?.length)
    },
  }
}
