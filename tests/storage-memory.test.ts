import { MemoryStorage } from './memory-storage.ts'
import { describeStorage } from './storage-conformance.ts'

describeStorage('in memory', async () => {
  const storage = new MemoryStorage()
  return {
    backend: storage,
    trash: ref => storage.trash(ref),
    remove: ref => storage.remove(ref),
    edit: (ref, content) => storage.edit(ref, content),
    async fileElsewhere() {
      const other = await storage.ensureRoot('Elsewhere', 'space-elsewhere')
      const { file } = await storage
        .space(other.ref)
        .create('songs', { name: 'there.txt', props: {}, type: 'text/plain' }, 'x')
      return file.ref
    },
  }
})
