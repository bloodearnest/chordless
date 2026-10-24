/**
 * A `World` (tests/sync-history.ts) on a Drive reached over the network: the real Drive API
 * client and the real storage adapter, sync devices made as the unit tests make them, a folder
 * of its own for the run, and the things that happen to a Drive behind the app's back done through
 * the API as a person would (the bin, restoring, a copy made under another id).
 *
 * Takes its token source and `fetch` from outside so that the unit suite can run it against
 * FakeDrive (tests/drive-real-world.test.ts) and the real-Drive suite against Google.
 */
import { createDriveApi } from '../../src/js/drive-client.ts'
import { createDriveStorage } from '../../src/js/storage/drive-storage.ts'
import type { SpaceStorage, StoredFile } from '../../src/js/storage/types.ts'
import { makeRig } from '../drive-harness.ts'
import type { HistoryFile, World } from '../sync-history.ts'
import { CALL_KINDS, type CallKind, faultyFetch } from './faults.ts'

export interface RealWorldOptions {
  getAccessToken: () => Promise<string>
  /** Defaults to the global `fetch`, read at each call */
  fetch?: typeof fetch
  /** The name of the run's space (so of its folder in Drive): a name nothing else uses */
  spaceName: string
  /** How long to let a real Drive catch up before reading it back */
  settleMs?: number
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export function makeRealWorld({
  getAccessToken,
  fetch: baseFetch = (input, init) => fetch(input, init),
  spaceName,
  settleMs = 0,
}: RealWorldOptions) {
  // The devices reach Drive through the failing fetch; the checks, and what is done to Drive
  // behind the devices' backs, do not
  const faults = faultyFetch(baseFetch)
  const deviceStorage = createDriveStorage(createDriveApi({ getAccessToken, fetch: faults.fetch }))
  const adminApi = createDriveApi({ getAccessToken, fetch: baseFetch })
  const adminStorage = createDriveStorage(adminApi)

  const rig = makeRig(() => deviceStorage)

  let root: string | undefined
  let space: SpaceStorage | undefined
  let setlistsFolder: string | undefined
  async function theSpace() {
    if (!root) {
      const found = await adminStorage.findRootByName(spaceName)
      if (!found) throw new Error(`The space "${spaceName}" has no folder in Drive yet`)
      root = found.ref
      space = adminStorage.space(root)
      setlistsFolder = await adminApi.getSetlistsFolder(root)
    }
    return { root, space: space as SpaceStorage, setlistsFolder: setlistsFolder as string }
  }

  const withContent = async (files: StoredFile[]): Promise<HistoryFile[]> => {
    const { space } = await theSpace()
    const ours = files.filter(f => f.props.setlistId)
    const contents = await space.readMany(ours.map(f => f.ref))
    return ours.flatMap((f, i) =>
      contents[i] === null
        ? []
        : [{ ref: f.ref, setlistId: f.props.setlistId, content: contents[i] as string }]
    )
  }

  const world: World & {
    counts: typeof faults.counts
    dispose(): Promise<void>
    close(): Promise<void>
  } = {
    counts: faults.counts,

    async makeDevice(name) {
      // (one at a time: the first makes the space's folder, the others find it)
      return rig.makeDevice(name, { spaceName })
    },

    async live() {
      const { space } = await theSpace()
      return withContent(await space.list('setlists'))
    },

    async trashed() {
      const { setlistsFolder } = await theSpace()
      const files = await adminApi.listDriveFiles(
        `'${setlistsFolder}' in parents and trashed = true`
      )
      const found: StoredFile[] = files
        .filter(f => f.appProperties?.setlistId)
        .map(f => ({
          ref: f.id,
          name: f.name ?? '',
          props: f.appProperties as Record<string, string>,
          rev: null,
          modified: null,
          created: null,
        }))
      // (a file in the bin is read as any other is)
      return withContent(found)
    },

    async trash(ref) {
      const { space } = await theSpace()
      await space.trash(ref)
    },

    async restore(ref) {
      await adminApi.driveRequest(`/files/${ref}`, {
        method: 'PATCH',
        body: JSON.stringify({ trashed: false }),
      })
    },

    async reid(ref) {
      // A duplicate was cleaned up, leaving another file for the setlist: same content and
      // properties, new id; the old one goes to the bin
      const { space } = await theSpace()
      const file = (await space.list('setlists')).find(f => f.ref === ref)
      if (!file) return
      const body = await space.readText(ref)
      await space.create(
        'setlists',
        { name: file.name, props: file.props, type: 'application/json' },
        body
      )
      await space.trash(ref)
    },

    failures: [...CALL_KINDS],
    fail(kind, options) {
      faults.fail(kind as CallKind, options)
    },
    clearFailures: () => faults.clear(),

    settle: () => (settleMs > 0 ? sleep(settleMs) : Promise.resolve()),

    /** Close the devices, and leave the run's folder in Drive to be looked at */
    close: () => rig.closeDevices(),

    /** Close the devices, and put the run's folder in Drive's bin (recoverable for 30 days) */
    async dispose() {
      await rig.closeDevices()
      if (root) await adminApi.trashFile(root)
    },
  }
  return world
}
