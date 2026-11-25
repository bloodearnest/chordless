import { expect } from '@open-wc/testing'
import { LibraryPads } from '../src/js/storage/library-pads.ts'
import { serverPadsFor } from '../src/js/storage/space-storage.ts'
import { TeamError } from '../src/js/worker-call.ts'

const { describe, it } = window

interface Seen {
  method: string
  path: string
  type: string | null
  auth: string | null
  body: string
}

function pads(answer: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = []
  const storage = new LibraryPads(
    {
      token: async () => 'token',
      origin: 'https://chordless.test',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        const one: Seen = {
          method: init?.method ?? 'GET',
          path: new URL(String(input)).pathname,
          type: headers.get('Content-Type'),
          auth: headers.get('Authorization'),
          body: init?.body instanceof Blob ? `blob:${init.body.size}` : String(init?.body ?? ''),
        }
        seen.push(one)
        return answer(one)
      }) as typeof fetch,
    },
    'lib 1'
  )
  return { storage, seen }
}

describe('a moved space’s pads, through the Worker', () => {
  it('lists the sets, and makes one by name, in the library’s own path', async () => {
    const { storage, seen } = pads(one =>
      one.method === 'POST'
        ? Response.json({ ref: 'SET1' })
        : Response.json([{ ref: 'SET1', name: 'Warm', modified: '2026-11-25T10:00:00.000Z' }])
    )
    expect(await storage.listSets()).to.deep.equal([
      { ref: 'SET1', name: 'Warm', modified: '2026-11-25T10:00:00.000Z' },
    ])
    expect(await storage.ensureSet('Warm')).to.equal('SET1')
    expect(seen.map(each => `${each.method} ${each.path}`)).to.deep.equal([
      'GET /api/libraries/lib%201/pads',
      'POST /api/libraries/lib%201/pads',
    ])
    expect(seen[1].body).to.equal('{"name":"Warm"}')
    expect(seen[0].auth).to.equal('Bearer token')
  })

  it('lists a set’s files, and none for a set that is not there', async () => {
    const { storage } = pads(one =>
      one.path.includes('/GONE/')
        ? Response.json({ error: 'No such pad set' }, { status: 404 })
        : one.path.includes('/BAD/')
          ? Response.json({ error: 'Broken' }, { status: 500 })
          : Response.json([{ ref: 'S:C', name: 'C.mp3', padKey: 'C', type: 'audio/mpeg', size: 5 }])
    )
    expect((await storage.listFiles('SET1')).map(each => each.padKey)).to.deep.equal(['C'])
    expect(await storage.listFiles('GONE')).to.deep.equal([])
    let error: unknown
    try {
      await storage.listFiles('BAD')
    } catch (caught) {
      error = caught
    }
    expect(error).to.be.instanceOf(TeamError)
  })

  it('sends a key’s audio as audio, and empties a set', async () => {
    const { storage, seen } = pads(() => new Response(null, { status: 204 }))
    await storage.addFile('SET1', 'C#', new Blob([new Uint8Array([1, 2, 3])]))
    await storage.trashFiles('SET1')
    expect(seen[0]).to.include({
      method: 'PUT',
      path: '/api/libraries/lib%201/pads/SET1/files/C%23',
      type: 'audio/mpeg',
      body: 'blob:3',
    })
    expect(`${seen[1].method} ${seen[1].path}`).to.equal(
      'POST /api/libraries/lib%201/pads/SET1/trash'
    )
  })

  it('reads a file as bytes or as a stream', async () => {
    const { storage, seen } = pads(() => new Response(new Uint8Array([9, 8, 7])))
    expect([...new Uint8Array(await storage.read('SET1:C'))]).to.deep.equal([9, 8, 7])
    const reader = (await storage.readStream('SET1:C')).getReader()
    expect([...((await reader.read()).value ?? [])]).to.deep.equal([9, 8, 7])
    expect(seen[0].path).to.equal('/api/libraries/lib%201/pads/files/SET1%3AC')
  })

  it('is the pad store of a space that has moved, and of no other', () => {
    expect(serverPadsFor({})).to.equal(null)
    expect(
      serverPadsFor({ server: { libraryId: 'lib', movedAt: '2026-11-25T10:00:00.000Z' } })
    ).to.be.instanceOf(LibraryPads)
  })
})
