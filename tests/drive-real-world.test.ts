import { expect } from '@open-wc/testing'
import { CALL_KINDS, callKind, faultyFetch } from './drive/faults.ts'
import { makeRealWorld } from './drive/real-world.ts'
import { installFakeDrive } from './fake-drive.ts'
import { type Mode, runHistory } from './sync-history.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

/**
 * The real-Drive suite's world (tests/drive/real-world.ts), run here against FakeDrive: the same
 * code the suite runs against Google (`just test-drive`), so what it does with the Drive API is
 * checked without an account. What a real Drive adds is for that suite to find.
 */
describe('the real-Drive world, on FakeDrive', () => {
  let drive: ReturnType<typeof installFakeDrive>
  let world: ReturnType<typeof makeRealWorld>

  beforeEach(() => {
    drive = installFakeDrive()
    world = makeRealWorld({
      getAccessToken: async () => 'fake-drive-token',
      spaceName: `drive-test ${crypto.randomUUID().slice(0, 8)}`,
    })
  })

  afterEach(async () => {
    await world.dispose()
    drive.uninstall()
    expect(
      drive.errors.map(e => e.message),
      'FakeDrive errors'
    ).to.deep.equal([])
  })

  it('shows a setlist one device made to the files, and to another device', async () => {
    const [a, b] = [await world.makeDevice('a'), await world.makeDevice('b')]
    const { createSetlist } = await import('../src/js/db.ts')
    const setlist = { ...createSetlist({ date: '2026-01-01' }), songs: [] }
    await a.db.saveSetlist(setlist)
    await a.sync.sync()
    expect((await world.live()).map(f => f.setlistId)).to.deep.equal([setlist.id])
    await b.sync.sync()
    expect((await b.db.getAllSetlists()).map(s => s.id)).to.deep.equal([setlist.id])
  })

  it('trashes, lists the bin, restores and re-ids files', async () => {
    const a = await world.makeDevice('a')
    const { createSetlist } = await import('../src/js/db.ts')
    const setlist = { ...createSetlist({ date: '2026-01-02' }), songs: [] }
    await a.db.saveSetlist(setlist)
    await a.sync.sync()

    const [file] = await world.live()
    await world.trash(file.ref)
    expect(await world.live()).to.deep.equal([])
    expect((await world.trashed()).map(f => f.setlistId)).to.deep.equal([setlist.id])

    await world.restore(file.ref)
    expect((await world.live()).map(f => f.ref)).to.deep.equal([file.ref])

    await world.reid(file.ref)
    const live = await world.live()
    expect(live).to.have.length(1)
    expect(live[0].ref).to.not.equal(file.ref)
    expect(live[0].setlistId).to.equal(setlist.id)
    expect(live[0].content).to.equal(file.content)
  })

  it('refuses to read a space that has no folder yet', async () => {
    let error: Error | undefined
    try {
      await world.live()
    } catch (e) {
      error = e as Error
    }
    expect(error?.message).to.contain('has no folder in Drive yet')
  })

  for (const mode of ['owner', 'concurrent', 'conflicts'] as Mode[]) {
    for (const seed of [1, 2, 3]) {
      it(`keeps devices and Drive consistent through its API (${mode}, seed ${seed})`, async function (this: {
        timeout(ms: number): void
      }) {
        this.timeout(60000)
        await runHistory(world, seed, mode, { devices: 3, steps: 25, checkEvery: 5 })
      })
    }
  }
})

describe('failures made to order in the requests to Drive', () => {
  const ok = async () => new Response('{}', { status: 200 })
  const send = (faults: ReturnType<typeof faultyFetch>, method: string, path: string) =>
    faults.fetch(`https://www.googleapis.com${path}`, { method })

  it('tells the kinds of call apart', () => {
    const kind = (method: string, path: string) =>
      callKind(method, `https://www.googleapis.com${path}`)
    expect(kind('GET', '/drive/v3/files?q=x')).to.equal('list')
    expect(kind('GET', '/drive/v3/files/abc?alt=media')).to.equal('read')
    expect(kind('GET', '/drive/v3/files/abc?fields=id')).to.equal('status')
    expect(kind('POST', '/drive/v3/files')).to.equal('create')
    expect(kind('POST', '/upload/drive/v3/files?uploadType=multipart')).to.equal('create')
    expect(kind('PATCH', '/drive/v3/files/abc')).to.equal('update')
    expect(kind('PATCH', '/upload/drive/v3/files/abc?uploadType=media')).to.equal('update')
    expect(kind('GET', '/drive/v3/changes?pageToken=1')).to.equal('changes')
    expect(kind('GET', '/drive/v3/about')).to.equal(null)
    expect(kind('DELETE', '/drive/v3/files/abc')).to.equal(null)
    expect(CALL_KINDS).to.include('changes')
  })

  it('lets calls through, counts them, and fails the next ones of a kind, after some are let by', async () => {
    const faults = faultyFetch(ok)
    faults.fail('list', { network: false, status: 500, times: 2, skip: 1 })
    expect((await send(faults, 'GET', '/drive/v3/files?q=x')).status).to.equal(200)
    expect((await send(faults, 'GET', '/drive/v3/files/abc?alt=media')).status).to.equal(200)
    const failed = await send(faults, 'GET', '/drive/v3/files?q=x')
    expect(failed.status).to.equal(500)
    expect((await failed.json()).error.message).to.equal('Injected 500')
    expect((await send(faults, 'GET', '/drive/v3/files?q=x')).status).to.equal(500)
    expect((await send(faults, 'GET', '/drive/v3/files?q=x')).status).to.equal(200)
    expect(faults.counts).to.deep.equal({ requests: 5, injected: 2 })
  })

  it('drops the connection when asked to, and forgets its failures when cleared', async () => {
    const faults = faultyFetch(ok)
    faults.fail('create', { network: true, status: 500, times: 5, skip: 0 })
    let error: Error | undefined
    try {
      await send(faults, 'POST', '/drive/v3/files')
    } catch (e) {
      error = e as Error
    }
    expect(error).to.be.instanceOf(TypeError)
    faults.clear()
    expect((await send(faults, 'POST', '/drive/v3/files')).status).to.equal(200)
  })
})
