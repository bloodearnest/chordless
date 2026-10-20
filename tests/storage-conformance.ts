/**
 * What every storage backend must do (src/js/storage/types.ts). Run against the in-memory fake
 * (storage-memory.test.ts) and the Drive adapter on FakeDrive (storage-drive.test.ts), so the
 * fake the engine tests rely on cannot drift from the real thing.
 */
import { expect } from '@open-wc/testing'
import type { FileInput, SpaceStorage, StorageBackend } from '../src/js/storage/types.ts'
import { must } from './must.ts'

/** A backend under test, with the ways of changing it behind its back that a test needs */
export interface StorageHarness {
  backend: StorageBackend
  /** Put a file in the backend's bin */
  trash(ref: string): void
  /** Delete a file for good */
  remove(ref: string): void
  /** Change a file's content, as another device would */
  edit(ref: string, content: string): void
  /** Make the backend list at most this many files at a time (so paging is exercised) */
  pageSize?(size: number): void
  /** Put a file where this space's root is not its parent, and give its ref */
  fileElsewhere(): Promise<string>
}

const { describe, it, beforeEach } = window

const input = (name: string, props: Record<string, string | null> = {}): FileInput => ({
  name,
  props,
  type: 'text/plain; charset=utf-8',
})

export function describeStorage(label: string, makeHarness: () => Promise<StorageHarness>): void {
  describe(`storage backend: ${label}`, () => {
    let harness: StorageHarness
    let backend: StorageBackend
    let space: SpaceStorage
    let rootRef: string

    beforeEach(async () => {
      harness = await makeHarness()
      backend = harness.backend
      const root = await backend.ensureRoot('Grace Church', 'space-1')
      rootRef = root.ref
      space = backend.space(rootRef)
    })

    describe('roots', () => {
      it('finds no root before one is made, then makes it once', async () => {
        const fresh = await makeHarness()
        expect(await fresh.backend.findRootByName('Other')).to.equal(null)
        const first = await fresh.backend.ensureRoot('Other', 'space-2')
        const second = await fresh.backend.ensureRoot('Other', 'space-2')
        expect(first.isNew).to.equal(true)
        expect(second).to.deep.equal({ ref: first.ref, isNew: false })
        expect((await fresh.backend.findRootByName('Other'))?.ref).to.equal(first.ref)
      })

      it('describes a root, and says whether it can be written', async () => {
        const info = must(await backend.inspectRoot(rootRef))
        expect(info.name).to.equal('Grace Church')
        expect(info.trashed).to.equal(false)
        expect(info.canWrite).to.equal(true)
      })

      it('knows no root it did not make', async () => {
        expect(await backend.inspectRoot('no-such-root')).to.equal(null)
      })

      it('renames a root', async () => {
        await backend.renameRoot(rootRef, 'Grace Chapel')
        expect(must(await backend.inspectRoot(rootRef)).name).to.equal('Grace Chapel')
        expect(await backend.findRootByName('Grace Church')).to.equal(null)
        expect((await backend.findRootByName('Grace Chapel'))?.ref).to.equal(rootRef)
      })

      it('says it is available', async () => {
        expect(await backend.available()).to.equal(true)
      })
    })

    describe('files', () => {
      it('lists nothing in a collection that has no files', async () => {
        expect(await space.list('songs')).to.deep.equal([])
        expect(await space.list('setlists')).to.deep.equal([])
      })

      it('creates a file and lists it with its name, props and times', async () => {
        const { file, intact } = await space.create(
          'setlists',
          input('2026-10-11-pat.json', { setlistId: 'abc' }),
          '{"id":"abc"}'
        )
        expect(intact).to.equal(true)
        expect(file.name).to.equal('2026-10-11-pat.json')
        expect(file.props.setlistId).to.equal('abc')
        expect(file.rev).to.be.a('string')

        const [listed] = await space.list('setlists')
        expect(listed.ref).to.equal(file.ref)
        expect(listed.props.setlistId).to.equal('abc')
        expect(listed.rev).to.equal(file.rev)
        expect(listed.modified).to.be.a('string')
        expect(await space.readText(file.ref)).to.equal('{"id":"abc"}')
      })

      it('keeps the collections apart', async () => {
        await space.create('songs', input('amazing-grace.txt'), '{title: Amazing Grace}')
        await space.create('setlists', input('set.json'), '{}')
        expect((await space.list('songs')).map(f => f.name)).to.deep.equal(['amazing-grace.txt'])
        expect((await space.list('setlists')).map(f => f.name)).to.deep.equal(['set.json'])
      })

      it('keeps the spaces apart', async () => {
        const other = backend.space((await backend.ensureRoot('Other', 'space-2')).ref)
        await space.create('songs', input('mine.txt'), 'x')
        expect(await other.list('songs')).to.deep.equal([])
      })

      it('round-trips text that is not ASCII', async () => {
        const content = '{title: Ô Seigneur — 神は愛}\n[G]Alléluia ♯'
        const { file } = await space.create('songs', input('alleluia.txt'), content)
        expect(await space.readText(file.ref)).to.equal(content)
      })

      it('updates content, name and props in place, with a new rev', async () => {
        const { file } = await space.create(
          'setlists',
          input('a.json', { setlistId: 'abc', leader: 'pat' }),
          'one'
        )
        const updated = await space.update(
          file.ref,
          input('b.json', { leader: null, extra: 'yes' }),
          'two'
        )
        expect(updated.file.ref).to.equal(file.ref)
        expect(updated.file.name).to.equal('b.json')
        expect(updated.file.rev).to.not.equal(file.rev)
        expect(updated.file.props).to.deep.equal({ setlistId: 'abc', extra: 'yes' })
        expect(await space.readText(file.ref)).to.equal('two')
        expect(await space.list('setlists')).to.have.length(1)
      })

      it('keeps the rev when the same content is written again', async () => {
        const { file } = await space.create('songs', input('a.txt'), 'same')
        const again = await space.update(file.ref, input('a.txt'), 'same')
        expect(again.file.rev).to.equal(file.rev)
      })

      it('changes the rev when the content is changed elsewhere', async () => {
        const { file } = await space.create('songs', input('a.txt'), 'one')
        harness.edit(file.ref, 'two')
        const [listed] = await space.list('songs')
        expect(listed.rev).to.not.equal(file.rev)
        expect(await space.readText(file.ref)).to.equal('two')
      })

      it('refuses to update a file that is gone', async () => {
        const { file } = await space.create('songs', input('a.txt'), 'one')
        harness.remove(file.ref)
        let error: unknown
        await space.update(file.ref, input('a.txt'), 'two').catch(e => {
          error = e
        })
        expect(error).to.be.instanceOf(Error)
        expect((error as { status?: number }).status).to.equal(404)
      })

      it('creates many files at once, in order', async () => {
        const results = await space.createMany('songs', [
          { input: input('one.txt', { songUuid: '1' }), body: 'one' },
          { input: input('two.txt', { songUuid: '2' }), body: 'two' },
          { input: input('three.txt', { songUuid: '3' }), body: 'three' },
        ])
        expect(results.map(r => r?.file.name)).to.deep.equal(['one.txt', 'two.txt', 'three.txt'])
        expect(await space.readText(must(results[1]).file.ref)).to.equal('two')
        expect(await space.list('songs')).to.have.length(3)
      })

      it('lists every file, past the size of one page', async () => {
        harness.pageSize?.(10)
        const items = Array.from({ length: 35 }, (_, i) => ({
          input: input(`song-${i}.txt`, { songUuid: String(i) }),
          body: `chart ${i}`,
        }))
        await space.createMany('songs', items)
        const listed = await space.list('songs')
        expect(listed).to.have.length(35)
        expect(new Set(listed.map(f => f.ref)).size).to.equal(35)
        expect(await space.inventory()).to.have.length.of.at.least(35)
      })
    })

    describe('what has gone from the space', () => {
      it('does not list a trashed file, but knows it is trashed', async () => {
        const { file } = await space.create('setlists', input('a.json'), '{}')
        harness.trash(file.ref)
        expect(await space.list('setlists')).to.deep.equal([])
        expect(await space.status(file.ref)).to.deep.equal({ trashed: true })
        expect((await space.inventory()).has(file.ref)).to.equal(false)
      })

      it('knows a deleted file is gone', async () => {
        const { file } = await space.create('setlists', input('a.json'), '{}')
        harness.remove(file.ref)
        expect(await space.status(file.ref)).to.equal(null)
      })

      it('knows a live file is there, and lists it in the inventory', async () => {
        const song = await space.create('songs', input('a.txt'), 'x')
        const setlist = await space.create('setlists', input('a.json'), '{}')
        expect(await space.status(song.file.ref)).to.deep.equal({ trashed: false })
        const inventory = await space.inventory()
        expect(inventory.has(song.file.ref)).to.equal(true)
        expect(inventory.has(setlist.file.ref)).to.equal(true)
      })

      it('finds a file that lives outside the space, but keeps it out of the inventory', async () => {
        const ref = await harness.fileElsewhere()
        expect(await space.status(ref)).to.deep.equal({ trashed: false })
        expect((await space.inventory()).has(ref)).to.equal(false)
      })
    })

    describe('members', () => {
      it('lists nobody for a space that is shared with no one', async () => {
        expect(await space.members()).to.deep.equal([])
      })
    })
  })
}
