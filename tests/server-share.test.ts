import { expect } from '@open-wc/testing'
import {
  createServerShare,
  findServerShare,
  serverShareUrl,
  stopServerShare,
} from '../src/js/server-share.ts'
import { TeamError } from '../src/js/worker-call.ts'

const { describe, it } = window

function worker(answer: (call: string, body: string) => Response) {
  const calls: string[] = []
  const connection = {
    token: async () => 'token',
    origin: 'https://chordless.test',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const call = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`
      calls.push(call)
      return answer(call, String(init?.body ?? ''))
    }) as typeof fetch,
  }
  return { calls, connection }
}

const share = { shareId: 'sh_aaaaaaaaaaaaaaaaaaaaaa', expiresAt: '2026-12-20T23:59:59.999Z' }

describe('a share link of a space stored on Chordless', () => {
  it('is the Worker’s own address, with no key in it', () => {
    expect(serverShareUrl('https://chordless.app', 'sh_abc')).to.equal(
      'https://chordless.app/s/sh_abc'
    )
  })

  it('finds the setlist’s share, and none when there is none', async () => {
    const some = worker(() => Response.json(share))
    expect(await findServerShare(some.connection, 'set 1')).to.deep.equal(share)
    expect(some.calls).to.deep.equal(['GET /api/shares?setlistId=set+1'])
    const none = worker(() => Response.json({ error: 'None' }, { status: 404 }))
    expect(await findServerShare(none.connection, 'set')).to.equal(null)
    const down = worker(() => Response.json({ error: 'Down' }, { status: 500 }))
    let error: unknown
    try {
      await findServerShare(down.connection, 'set')
    } catch (caught) {
      error = caught
    }
    expect(error).to.be.instanceOf(TeamError)
  })

  it('makes a share, and takes the one that is there when another device made it first', async () => {
    const made = worker(() => Response.json(share, { status: 201 }))
    expect(await createServerShare(made.connection, 'set')).to.deep.equal(share)
    expect(made.calls).to.deep.equal(['POST /api/shares'])
    const raced = worker(call =>
      call.startsWith('POST')
        ? Response.json({ error: 'Already' }, { status: 409 })
        : Response.json(share)
    )
    expect(await createServerShare(raced.connection, 'set')).to.deep.equal(share)
    // (a conflict with nothing there after all, and any other refusal, is an error)
    for (const status of [409, 403]) {
      const refused = worker(call =>
        call.startsWith('POST')
          ? Response.json({ error: 'No' }, { status })
          : Response.json({ error: 'None' }, { status: 404 })
      )
      let error: unknown
      try {
        await createServerShare(refused.connection, 'set')
      } catch (caught) {
        error = caught
      }
      expect(error).to.be.instanceOf(TeamError)
    }
  })

  it('stops a share by its id', async () => {
    const stopped = worker(() => new Response(null, { status: 204 }))
    await stopServerShare(stopped.connection, 'sh_aaaaaaaaaaaaaaaaaaaaaa')
    expect(stopped.calls).to.deep.equal(['DELETE /api/shares/sh_aaaaaaaaaaaaaaaaaaaaaa'])
  })
})
