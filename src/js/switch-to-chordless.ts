/**
 * A Personal space on a device that is still on Drive, when the account has moved to Chordless on another device
 * (docs/CENTRAL_STORAGE.md, step 5): the device switches too, by itself, at its next sync. An account has one Personal
 * space and one personal library, so a device that is signed in to Chordless, with a Personal space not yet moved, and an
 * account that already holds songs or setlists, has been left behind. It moves as a person would press Move and answer yes
 * to combining (what the device has goes up, and what the server has comes down: `space-move.ts`), and Drive is never
 * synced again. Two people use this, so there is no question to ask, only a note to say it was done.
 */
import type { Space } from './data-types.ts'
import { callWorker, type WorkerConnection } from './worker-call.ts'

/** How long a device waits before asking the Worker again about a space it found nothing to switch for */
export const CHECK_EVERY_MS = 10 * 60_000

/** What the account holds on the server, as `GET /api/account/library` says */
export interface AccountHolds {
  libraryId: string | null
  songs: number
  setlists: number
}

export async function accountHolds(connection: WorkerConnection): Promise<AccountHolds> {
  return (await (
    await callWorker({ path: '/api/account/library' }, connection)
  ).json()) as AccountHolds
}

export interface SwitchDeps {
  now(): number
  holds(): Promise<AccountHolds>
  /** Move the space to the server, combining with what is there (space-move.ts) */
  move(spaceId: string): Promise<void>
  /** Said before the move starts, and after it is done */
  switching(): void
  switched(): void
}

/** When each space was last asked about, and the switches running now (one at a time for a space) */
const asked = new Map<string, number>()
const running = new Map<string, Promise<boolean>>()

/** Forget what was asked (a test's) */
export function forgetAsked(): void {
  asked.clear()
  running.clear()
}

/**
 * Switch the space to Chordless if the account has moved. True if it did. Not a Team's space, and not one already moved;
 * the Worker is asked at most once in `CHECK_EVERY_MS`, however often the space syncs. A failure is thrown, and asked
 * about again at the next sync.
 */
export function switchIfAccountMoved(
  space: Pick<Space, 'id' | 'team' | 'server'>,
  deps: SwitchDeps
): Promise<boolean> {
  if (space.team || space.server) return Promise.resolve(false)
  const going = running.get(space.id)
  if (going) return going
  const last = asked.get(space.id)
  if (last !== undefined && deps.now() - last < CHECK_EVERY_MS) return Promise.resolve(false)
  asked.set(space.id, deps.now())
  const run = (async () => {
    const held = await deps.holds()
    if (held.songs + held.setlists === 0) return false
    deps.switching()
    await deps.move(space.id)
    deps.switched()
    return true
  })()
  running.set(space.id, run)
  const done = () => running.delete(space.id)
  run.then(done, () => {
    // (a failure is asked about again at the next sync, not in ten minutes)
    asked.delete(space.id)
    done()
  })
  return run
}

/* v8 ignore start -- wiring to the real account, Worker, database and toasts: the rule above is what the tests hold */
let toldFailure = false

/** For the space in use, as the app syncs: true if it has just switched, so it is not a Drive space any more */
export async function switchCurrentSpaceIfMoved(space: Space): Promise<boolean> {
  if (space.team || space.server || !navigator.onLine) return false
  const [{ isAuthenticated }, { workerConnection }, { toast }, { t }, { errorMessage }] =
    await Promise.all([
      import('./google-auth.ts'),
      import('./storage/space-storage.ts'),
      import('./toast.ts'),
      import('./text.ts'),
      import('./utils/errors.ts'),
    ])
  if (!(await isAuthenticated())) return false
  const connection = workerConnection()
  try {
    return await switchIfAccountMoved(space, {
      now: () => Date.now(),
      holds: () => accountHolds(connection),
      move: async id => (await import('./space-data-runtime.ts')).moveSpaceToServerNow(id, true),
      switching: () => toast(t('space-switching')),
      switched: () => toast(t('space-switched')),
    })
  } catch (error) {
    console.warn('[Switch] Could not switch this device to Chordless:', error)
    if (!toldFailure) {
      toldFailure = true
      toast(t('space-switch-failed'), { kind: 'error', details: errorMessage(error) })
    }
    return false
  }
}
/* v8 ignore stop */
