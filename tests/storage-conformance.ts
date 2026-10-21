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
  /** What someone with only a file's ref (a share link's recipient) is given of it */
  publicDownload(ref: string): { status: number; bytes?: Uint8Array }
  /** Put a file where this space's root is not its parent, and give its ref */
  fileElsewhere(): Promise<string>
}

const { describe, it, beforeEach } = window

/** A file's input; setlists are JSON and everything else is text, as the app writes them */
const input = (name: string, props: Record<string, string | null> = {}): FileInput => ({
  name,
  props,
  type: name.endsWith('.json') ? 'application/json' : 'text/plain',
})

/** A space's storage under test, with the ways of changing it behind its back that a test needs */
export interface SpaceHarness {
  space: SpaceStorage
  /** A second space on the same backend */
  otherSpace(): Promise<SpaceStorage>
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
  /** The space keeps to its own tree: it knows nothing of a file elsewhere (a team space) */
  scoped?: boolean
}

/** What every space's storage must do: the files in it, and what has gone from it */
export function describeSpaceStorage(
  label: string,
  makeHarness: () => Promise<SpaceHarness>
): void {
  describe(`space storage: ${label}`, () => {
    let harness: SpaceHarness
    let space: SpaceStorage

    beforeEach(async () => {
      harness = await makeHarness()
      space = harness.space
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
        const other = await harness.otherSpace()
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

      it('reads many files at once, in order, with null for one that is gone', async () => {
        const a = await space.create('songs', input('a.txt'), 'one')
        const b = await space.create('songs', input('b.txt'), 'two')
        const c = await space.create('songs', input('c.txt'), 'three')
        harness.remove(b.file.ref)
        expect(await space.readMany([c.file.ref, a.file.ref, b.file.ref])).to.deep.equal([
          'three',
          'one',
          null,
        ])
        expect(await space.readMany([])).to.deep.equal([])
      })

      it('updates many files at once, in order, with null for one that is gone', async () => {
        const a = await space.create('songs', input('a.txt'), 'one')
        const b = await space.create('songs', input('b.txt'), 'two')
        harness.remove(b.file.ref)
        const results = await space.updateMany([
          { ref: a.file.ref, input: input('a2.txt', { songUuid: '1' }), body: 'uno' },
          { ref: b.file.ref, input: input('b.txt'), body: 'dos' },
        ])
        expect(results[1]).to.equal(null)
        const first = must(results[0])
        expect(first.file.ref).to.equal(a.file.ref)
        expect(first.file.name).to.equal('a2.txt')
        expect(first.file.rev).to.not.equal(a.file.rev)
        expect(await space.readText(a.file.ref)).to.equal('uno')
        expect(await space.updateMany([])).to.deep.equal([])
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
        expect(must(await space.status(file.ref)).trashed).to.equal(true)
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
        const status = must(await space.status(song.file.ref))
        expect(status.trashed).to.equal(false)
        expect(status.name).to.equal('a.txt')
        expect(status.rev).to.equal(song.file.rev)
        const inventory = await space.inventory()
        expect(inventory.has(song.file.ref)).to.equal(true)
        expect(inventory.has(setlist.file.ref)).to.equal(true)
      })

      it('keeps a file that lives outside the space out of the inventory', async () => {
        const ref = await harness.fileElsewhere()
        if (harness.scoped) {
          // (a space that keeps to its own tree knows nothing of it)
          expect(await space.status(ref)).to.equal(null)
        } else {
          expect(must(await space.status(ref)).trashed).to.equal(false)
        }
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

export function describeStorage(label: string, makeHarness: () => Promise<StorageHarness>): void {
  describeSpaceStorage(label, async () => {
    const harness = await makeHarness()
    const root = await harness.backend.ensureRoot('Grace Church', 'space-1')
    return {
      space: harness.backend.space(root.ref),
      async otherSpace() {
        return harness.backend.space((await harness.backend.ensureRoot('Other', 'space-2')).ref)
      },
      trash: ref => harness.trash(ref),
      remove: ref => harness.remove(ref),
      edit: (ref, content) => harness.edit(ref, content),
      pageSize: harness.pageSize && (size => harness.pageSize?.(size)),
      fileElsewhere: () => harness.fileElsewhere(),
    }
  })

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

    describe('share files', () => {
      const shareInput = (id: string) => ({
        name: `${id}.share`,
        props: { type: 'share', setlistId: id, expires: '2026-11-01' },
        type: 'application/octet-stream',
      })
      const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 10, 13])

      it('lists no shares in a space nothing was shared from', async () => {
        expect(await space.list('shares')).to.deep.equal([])
      })

      it('keeps shares out of the songs and setlists', async () => {
        await space.create('shares', shareInput('a'), bytes)
        expect(await space.list('songs')).to.deep.equal([])
        expect(await space.list('setlists')).to.deep.equal([])
        expect((await space.list('shares')).map(f => f.props.setlistId)).to.deep.equal(['a'])
      })

      it('makes a share readable by its ref alone, byte for byte, and not before', async () => {
        const open = await space.create('shares', shareInput('a'), bytes, { publicLink: true })
        const closed = await space.create('shares', shareInput('b'), bytes)
        const download = harness.publicDownload(open.file.ref)
        expect(download.status).to.equal(200)
        expect(Array.from(must(download.bytes))).to.deep.equal(Array.from(bytes))
        expect(harness.publicDownload(closed.file.ref).status).to.equal(404)
      })

      it('keeps a share public when its content is replaced, with the same ref', async () => {
        const { file } = await space.create('shares', shareInput('a'), bytes, { publicLink: true })
        const more = new Uint8Array([9, 8, 7, 255])
        const updated = await space.update(file.ref, shareInput('a'), more)
        expect(updated.file.ref).to.equal(file.ref)
        expect(Array.from(must(harness.publicDownload(file.ref).bytes))).to.deep.equal([
          9, 8, 7, 255,
        ])
      })

      it('ends a share: unpublished, then in the bin, and no longer listed', async () => {
        const { file } = await space.create('shares', shareInput('a'), bytes, { publicLink: true })
        await space.unpublish(file.ref)
        expect(harness.publicDownload(file.ref).status).to.equal(404)
        await space.trash(file.ref)
        expect(await space.list('shares')).to.deep.equal([])
        expect(must(await space.status(file.ref)).trashed).to.equal(true)
      })

      it('lets a file that is already gone be unpublished and binned', async () => {
        const { file } = await space.create('shares', shareInput('a'), bytes, { publicLink: true })
        harness.remove(file.ref)
        await space.unpublish(file.ref)
        await space.trash(file.ref)
      })
    })

    describe('pad sets', () => {
      const pads = () => backend.pads
      // Every byte value, so anything that treated the audio as text would corrupt it
      const allBytes = Uint8Array.from({ length: 256 }, (_, i) => i)
      const audio = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: 'audio/mpeg' })

      it('has no sets until one is made, and makes a set once for a name', async () => {
        expect(await pads().listSets()).to.deep.equal([])
        const ref = await pads().ensureSet('Warm pads')
        expect(await pads().ensureSet('Warm pads')).to.equal(ref)
        const other = await pads().ensureSet('Bright pads')
        expect(other).to.not.equal(ref)
        const sets = await pads().listSets()
        expect(sets.map(set => set.name).sort()).to.deep.equal(['Bright pads', 'Warm pads'])
        expect(sets.find(set => set.ref === ref)?.modified).to.be.a('string')
      })

      it('keeps a file for each key, with its type and size, and gives its audio back byte for byte', async () => {
        const ref = await pads().ensureSet('Warm pads')
        await pads().addFile(ref, 'C', audio(allBytes))
        await pads().addFile(ref, 'F#', audio(new Uint8Array([1, 2, 3])))

        const files = await pads().listFiles(ref)
        expect(files.map(file => file.padKey).sort()).to.deep.equal(['C', 'F#'])
        const c = must(files.find(file => file.padKey === 'C'))
        expect(c.type).to.equal('audio/mpeg')
        expect(c.size).to.equal(256)
        expect(c.name).to.contain('C')
        expect(Array.from(new Uint8Array(await pads().read(c.ref)))).to.deep.equal(
          Array.from(allBytes)
        )
      })

      it('keeps the files of one set apart from another', async () => {
        const first = await pads().ensureSet('One')
        const second = await pads().ensureSet('Two')
        await pads().addFile(first, 'C', audio(new Uint8Array([1])))
        expect(await pads().listFiles(second)).to.deep.equal([])
      })

      it('moves the files of a set to the bin, and leaves the set to be filled again', async () => {
        const ref = await pads().ensureSet('Warm pads')
        await pads().addFile(ref, 'C', audio(new Uint8Array([1])))
        await pads().trashFiles(ref)

        expect(await pads().listFiles(ref)).to.deep.equal([])
        expect((await pads().listSets()).map(set => set.ref)).to.deep.equal([ref])
        await pads().addFile(ref, 'C', audio(new Uint8Array([2])))
        expect(await pads().listFiles(ref)).to.have.length(1)
      })

      it('has no files for a set that is not there', async () => {
        expect(await pads().listFiles('no-such-set')).to.deep.equal([])
      })
    })
  })
}
