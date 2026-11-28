import { expect } from '@open-wc/testing'
import {
  accountHolds,
  CHECK_EVERY_MS,
  forgetAsked,
  type SwitchDeps,
  switchIfAccountMoved,
} from '../src/js/switch-to-chordless.ts'

const { describe, it, beforeEach } = window

describe('a device follows an account that moved to Chordless', () => {
  let log: string[]
  let clock: number
  let holds: { libraryId: string | null; songs: number; setlists: number }
  let failMove: boolean

  const deps = (): SwitchDeps => ({
    now: () => clock,
    holds: async () => {
      log.push('asked')
      return holds
    },
    move: async id => {
      log.push(`move ${id}`)
      if (failMove) throw new Error('offline')
    },
    switching: why => log.push(why === 'drive' ? 'switching from drive' : 'switching'),
    switched: why => log.push(why === 'drive' ? 'switched from drive' : 'switched'),
  })
  const personal = { id: 'p', team: undefined, server: undefined }

  beforeEach(() => {
    forgetAsked()
    log = []
    clock = 1_000_000
    holds = { libraryId: 'lib', songs: 97, setlists: 12 }
    failMove = false
  })

  it('moves a Personal space still on Drive when the account holds songs or setlists, saying so before and after', async () => {
    expect(await switchIfAccountMoved(personal, deps())).to.equal(true)
    expect(log).to.deep.equal(['asked', 'switching', 'move p', 'switched'])
  })

  it('moves for setlists alone, or songs alone, and not for an account that holds nothing', async () => {
    holds = { libraryId: 'lib', songs: 0, setlists: 3 }
    expect(await switchIfAccountMoved(personal, deps())).to.equal(true)
    forgetAsked()
    holds = { libraryId: 'lib', songs: 5, setlists: 0 }
    expect(await switchIfAccountMoved(personal, deps())).to.equal(true)
    forgetAsked()
    log = []
    holds = { libraryId: null, songs: 0, setlists: 0 }
    expect(await switchIfAccountMoved(personal, deps())).to.equal(false)
    holds = { libraryId: 'lib', songs: 0, setlists: 0 }
    forgetAsked()
    expect(await switchIfAccountMoved(personal, deps())).to.equal(false)
    expect(log).to.deep.equal(['asked', 'asked'])
  })

  it('moves a Personal space linked to a Drive folder by itself, without asking, and says it is leaving Drive', async () => {
    holds = { libraryId: null, songs: 0, setlists: 0 }
    expect(await switchIfAccountMoved({ ...personal, rootRef: 'folder' }, deps())).to.equal(true)
    expect(log).to.deep.equal(['switching from drive', 'move p', 'switched from drive'])
  })

  it('leaves a Team’s space, and a space that has moved, alone, and does not ask', async () => {
    expect(
      await switchIfAccountMoved(
        { id: 't', team: { id: 'x', role: 'writer' }, server: undefined },
        deps()
      )
    ).to.equal(false)
    expect(
      await switchIfAccountMoved(
        {
          id: 'm',
          team: undefined,
          server: { libraryId: 'l', movedAt: '2026-11-27T00:00:00.000Z' },
        },
        deps()
      )
    ).to.equal(false)
    expect(log).to.deep.equal([])
  })

  it('asks the Worker at most once in ten minutes about a space it found nothing for', async () => {
    holds = { libraryId: null, songs: 0, setlists: 0 }
    await switchIfAccountMoved(personal, deps())
    clock += CHECK_EVERY_MS - 1
    await switchIfAccountMoved(personal, deps())
    expect(log).to.deep.equal(['asked'])
    clock += 2
    await switchIfAccountMoved(personal, deps())
    expect(log).to.deep.equal(['asked', 'asked'])
  })

  it('asks again at the next sync when the move failed, and is not run twice at once', async () => {
    failMove = true
    let error: unknown
    try {
      await switchIfAccountMoved(personal, deps())
    } catch (caught) {
      error = caught
    }
    expect(String(error)).to.contain('offline')
    failMove = false
    log = []
    expect(await switchIfAccountMoved(personal, deps())).to.equal(true)
    expect(log).to.deep.equal(['asked', 'switching', 'move p', 'switched'])
    // (two syncs at once make one move)
    forgetAsked()
    log = []
    const [one, two] = await Promise.all([
      switchIfAccountMoved(personal, deps()),
      switchIfAccountMoved(personal, deps()),
    ])
    expect([one, two]).to.deep.equal([true, true])
    expect(log.filter(line => line.startsWith('move'))).to.have.length(1)
  })

  it('asks the Worker what the account holds', async () => {
    const seen: string[] = []
    const answer = await accountHolds({
      token: async () => 't',
      origin: 'https://chordless.test',
      fetch: (async (input: RequestInfo | URL) => {
        seen.push(new URL(String(input)).pathname)
        return Response.json({ libraryId: 'lib', songs: 4, setlists: 2 })
      }) as typeof fetch,
    })
    expect(answer).to.deep.equal({ libraryId: 'lib', songs: 4, setlists: 2 })
    expect(seen).to.deep.equal(['/api/account/library'])
  })
})
