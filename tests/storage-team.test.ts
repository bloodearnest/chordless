import { expect } from '@open-wc/testing'
import { TeamStorage, TeamStorageError } from '../src/js/storage/team-storage.ts'
import { must } from './must.ts'
import { describeSpaceStorage } from './storage-conformance.ts'
import { makeTeamRig, ORIGIN } from './team-context.ts'

const { describe, it } = window

const text = { name: 'a.txt', props: {}, type: 'text/plain' }

/** A TeamStorage for the rig, signed in with a token */
function teamFor(rig: Awaited<ReturnType<typeof makeTeamRig>>, token = 'writer-token') {
  return new TeamStorage({ token: async () => token, origin: ORIGIN, fetch: rig.fetch })
}

describeSpaceStorage('team space (over the Worker, on memory)', async () => {
  const rig = await makeTeamRig()
  const team = teamFor(rig)
  return {
    space: team.space('space-1'),
    otherSpace: async () => team.space('space-2'),
    trash: ref => rig.storage.trash(ref),
    remove: ref => rig.storage.remove(ref),
    edit: (ref, content) => rig.storage.edit(ref, content),
    async fileElsewhere() {
      const other = await rig.storage.ensureRoot('Elsewhere', 'space-elsewhere')
      const { file } = await rig.storage.space(other.ref).create('songs', text, 'x')
      return file.ref
    },
    scoped: true,
  }
})

describe('TeamStorage', () => {
  it('describes the space as its role allows: a reader cannot write', async () => {
    const rig = await makeTeamRig()
    rig.roles.set('reader-token', 'reader')
    const writer = must(await teamFor(rig).inspectRoot('space-1'))
    const reader = must(await teamFor(rig, 'reader-token').inspectRoot('space-1'))
    expect(writer).to.deep.include({ name: 'Team space-1', trashed: false, canWrite: true })
    expect(reader.canWrite).to.equal(false)
  })

  it('knows no space that is not there, and refuses one that is not yours', async () => {
    const rig = await makeTeamRig()
    expect(await teamFor(rig).inspectRoot('no-such-space')).to.equal(null)
    rig.roles.set('stranger', 'none')
    let error: unknown
    await teamFor(rig, 'stranger')
      .inspectRoot('space-1')
      .catch(e => {
        error = e
      })
    expect((error as TeamStorageError).status).to.equal(403)
  })

  it('lets a reader read but not write, and counts the refusal', async () => {
    const rig = await makeTeamRig()
    rig.roles.set('reader-token', 'reader')
    const { file } = await rig.storage.space(rig.spaces[0].root).create('songs', text, 'one')
    const reader = teamFor(rig, 'reader-token')
    const space = reader.space('space-1')
    expect(await space.readText(file.ref)).to.equal('one')
    expect(await space.readMany([file.ref])).to.deep.equal(['one'])
    expect(await space.list('songs')).to.have.length(1)

    expect(reader.writeRefusals()).to.equal(0)
    let error: unknown
    await space.update(file.ref, text, 'two').catch(e => {
      error = e
    })
    expect((error as TeamStorageError).status).to.equal(403)
    expect(reader.writeRefusals()).to.equal(1)
    expect(await space.readText(file.ref)).to.equal('one')
  })

  it("keeps a member to the space: another space's files are out of reach", async () => {
    const rig = await makeTeamRig()
    const { file } = await rig.storage.space(rig.spaces[1].root).create('songs', text, 'secret')
    const space = teamFor(rig).space('space-1')
    expect(await space.status(file.ref)).to.equal(null)
    expect(await space.readMany([file.ref])).to.deep.equal([null])
    expect(await space.updateMany([{ ref: file.ref, input: text, body: 'x' }])).to.deep.equal([
      null,
    ])
    await space.trash(file.ref)
    expect(await rig.storage.space(rig.spaces[1].root).readText(file.ref)).to.equal('secret')
    let error: unknown
    await space.readText(file.ref).catch(e => {
      error = e
    })
    expect((error as TeamStorageError).status).to.equal(404)
  })

  it('says what a team space does not do yet', async () => {
    const team = teamFor(await makeTeamRig())
    const space = team.space('space-1')
    const failure = async (work: () => unknown) => {
      try {
        await work()
      } catch (error) {
        return (error as Error).message
      }
      return ''
    }
    expect(await failure(() => space.create('shares', text, 'x', { publicLink: true }))).to.match(
      /not supported yet/
    )
    expect(await failure(() => space.create('songs', text, new Uint8Array([1])))).to.match(
      /text only/
    )
    expect(await failure(() => space.unpublish('anything'))).to.match(/not served/)
    expect(await failure(() => team.ensureRoot())).to.match(/joined/)
    expect(await failure(() => team.renameRoot())).to.match(/admin/)
    expect(await failure(() => team.pads)).to.match(/Pad sets/)
    expect(await team.findRootByName()).to.equal(null)
  })

  it('is available when it has a token, and not when it has none', async () => {
    const rig = await makeTeamRig()
    expect(await teamFor(rig).available()).to.equal(true)
    const none = new TeamStorage({
      token: async () => {
        throw new Error('signed out')
      },
      origin: ORIGIN,
      fetch: rig.fetch,
    })
    expect(await none.available()).to.equal(false)
  })

  it('turns an answer that is not ours into an error with its status', async () => {
    const down = new TeamStorage({
      token: async () => 't',
      origin: ORIGIN,
      fetch: async () => new Response('<html>Bad gateway</html>', { status: 502 }),
    })
    let error: unknown
    await down
      .space('space-1')
      .list('songs')
      .catch(e => {
        error = e
      })
    expect(error).to.be.instanceOf(TeamStorageError)
    expect((error as TeamStorageError).status).to.equal(502)
  })

  it('uses the status text when the answer is JSON without a reason', async () => {
    const down = new TeamStorage({
      token: async () => 't',
      origin: ORIGIN,
      fetch: async () => Response.json({}, { status: 500, statusText: 'Server broke' }),
    })
    let error: unknown
    await down
      .space('space-1')
      .inventory()
      .catch(e => {
        error = e
      })
    expect((error as TeamStorageError).message).to.equal('Server broke')
  })

  it('passes on a refusal to say what a file is, and has nothing to create or update in an empty batch', async () => {
    const rig = await makeTeamRig()
    rig.roles.set('stranger', 'none')
    const space = teamFor(rig, 'stranger').space('space-1')
    let error: unknown
    await space.status('anything').catch(e => {
      error = e
    })
    expect((error as TeamStorageError).status).to.equal(403)

    const calls = rig.storage.calls.length
    const mine = teamFor(rig).space('space-1')
    expect(await mine.createMany('songs', [])).to.deep.equal([])
    expect(await mine.updateMany([])).to.deep.equal([])
    expect(await mine.readMany([])).to.deep.equal([])
    expect(rig.storage.calls.length).to.equal(calls)
  })
})
