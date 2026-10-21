/**
 * Notes, in the team space's Durable Object, the refs of the files a space's storage reveals
 * (`TeamSpaceState.addRefs`, team-state.ts), so the Worker can tell cheaply which files are in the
 * space's tree (`owns`, team-api.ts).
 *
 * The files are not all made through the Worker: the owner syncs straight to Drive. But a listing
 * of the space is already scoped to its root, and a member lists before they read, so noting what a
 * listing, an inventory or a create returns covers them. A ref that none of these has shown is not
 * known (a read of it is a 404 until the next listing).
 */
import type { SpaceStorage } from '../../src/js/storage/types.ts'
import type { TeamSpaceApi } from './team-state.ts'

/** The space's storage, noting each ref it shows before the answer goes on */
export function notingRefs(space: SpaceStorage, room: Pick<TeamSpaceApi, 'addRefs'>): SpaceStorage {
  return {
    members: () => space.members(),
    async list(collection) {
      const files = await space.list(collection)
      await room.addRefs(files.map(file => file.ref))
      return files
    },
    async inventory() {
      const refs = await space.inventory()
      await room.addRefs([...refs])
      return refs
    },
    status: ref => space.status(ref),
    readText: ref => space.readText(ref),
    readMany: refs => space.readMany(refs),
    async create(collection, input, body, options) {
      const result = await space.create(collection, input, body, options)
      await room.addRefs([result.file.ref])
      return result
    },
    async createMany(collection, items) {
      const results = await space.createMany(collection, items)
      await room.addRefs(results.flatMap(result => (result ? [result.file.ref] : [])))
      return results
    },
    update: (ref, input, body) => space.update(ref, input, body),
    updateMany: items => space.updateMany(items),
    unpublish: ref => space.unpublish(ref),
    trash: ref => space.trash(ref),
  }
}
