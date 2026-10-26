import { expect } from '@open-wc/testing'
import {
  LiveChannel,
  type LiveSocket,
  type LiveStatus,
  PING_EVERY_MS,
  PONG_WAIT_MS,
  RETRY_FIRST_MS,
  RETRY_LAST_MS,
} from '../src/js/live-channel.ts'
import { CHANGED, LIVE_PROTOCOL, PING, PONG } from '../src/js/live-protocol.ts'

const { describe, it } = window

/** A socket the test drives: it says what the page sent, and the test makes the server's end happen */
class FakeSocket implements LiveSocket {
  sent: string[] = []
  closed = false
  #listeners: Record<string, ((event: { data: unknown }) => void)[]> = {}
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
  }
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    // biome-ignore lint/suspicious/noAssignInExpressions: a map of lists
    ;(this.#listeners[type] ??= []).push(listener)
  }
  /** The server's end: opened, a message arrived, or it dropped */
  emit(type: 'open' | 'close' | 'error' | 'message', data?: unknown) {
    for (const listener of this.#listeners[type] ?? []) listener({ data })
  }
}

/** A channel on a clock, a token and sockets the test controls */
function rig() {
  const sockets: { socket: FakeSocket; protocols: string[] }[] = []
  const timers: { ms: number; fn: () => void; cancelled: boolean }[] = []
  const world = {
    tokens: 0,
    tokenFails: false,
    statuses: [] as LiveStatus[],
    changed: 0,
    connected: 0,
  }
  const channel = new LiveChannel(
    {
      open: protocols => {
        const socket = new FakeSocket()
        sockets.push({ socket, protocols })
        return socket
      },
      token: async () => {
        if (world.tokenFails) throw new Error('signed out')
        return `token-${++world.tokens}`
      },
      later: (ms, fn) => {
        const timer = { ms, fn, cancelled: false }
        timers.push(timer)
        return () => {
          timer.cancelled = true
        }
      },
      random: () => 0,
    },
    {
      status: status => world.statuses.push(status),
      changed: () => world.changed++,
      connected: () => world.connected++,
    }
  )
  /** Let a pending token and connect run */
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  /** The timers still wanted, oldest first */
  const pending = () => timers.filter(timer => !timer.cancelled)
  /** Run the timer of this length that is still wanted */
  const fire = (ms: number) => {
    const timer = pending().find(each => each.ms === ms)
    expect(timer, `a timer of ${ms} ms`).to.exist
    if (!timer) return
    timer.cancelled = true
    timer.fn()
  }
  return { channel, sockets, world, settle, pending, fire, timers }
}

/** A channel that is up */
async function connected() {
  const r = rig()
  r.channel.start()
  await r.settle()
  r.sockets[0].socket.emit('open')
  return r
}

describe('The live channel', () => {
  it('connects with the subprotocol and a fresh ID token, and says when it is up', async () => {
    const r = rig()
    r.channel.start()
    await r.settle()
    expect(r.sockets[0].protocols).to.deep.equal([LIVE_PROTOCOL, 'token-1'])
    expect(r.world.statuses).to.deep.equal(['connecting'])

    r.sockets[0].socket.emit('open')
    expect(r.world.statuses).to.deep.equal(['connecting', 'connected'])
    expect(r.channel.status).to.equal('connected')
    expect(r.world.connected).to.equal(1)
  })

  it('asks for the subprotocol alone where it has nothing to prove (a recipient of a share)', async () => {
    const sockets: string[][] = []
    const channel = new LiveChannel(
      {
        open: protocols => {
          sockets.push(protocols)
          return new FakeSocket()
        },
        token: async () => null,
        later: () => () => {},
        random: () => 0,
      },
      { status: () => {}, changed: () => {}, connected: () => {} }
    )
    channel.start()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(sockets).to.deep.equal([[LIVE_PROTOCOL]])
    channel.stop()
  })

  it('tells of "changed" from the others, and ignores anything else', async () => {
    const { sockets, world } = await connected()
    sockets[0].socket.emit('message', CHANGED)
    sockets[0].socket.emit('message', '{"type":"other"}')
    sockets[0].socket.emit('message', 'whatever')
    expect(world.changed).to.equal(1)
  })

  it('sends "changed" when it is up, and says it could not when it is not', async () => {
    const r = rig()
    expect(r.channel.notify()).to.equal(false)
    r.channel.start()
    await r.settle()
    expect(r.channel.notify(), 'still connecting').to.equal(false)
    r.sockets[0].socket.emit('open')
    expect(r.channel.notify()).to.equal(true)
    expect(r.sockets[0].socket.sent).to.deep.equal([CHANGED])
  })

  it('pings now and then, and carries on when it is answered', async () => {
    const r = await connected()
    r.fire(PING_EVERY_MS)
    expect(r.sockets[0].socket.sent).to.deep.equal([PING])
    r.sockets[0].socket.emit('message', PONG)
    expect(r.pending().map(timer => timer.ms)).to.deep.equal([PING_EVERY_MS])
    expect(r.channel.status).to.equal('connected')
  })

  it('takes a ping that is not answered for a dead socket, and connects again', async () => {
    const r = await connected()
    r.fire(PING_EVERY_MS)
    r.fire(PONG_WAIT_MS)
    expect(r.channel.status).to.equal('offline')
    expect(r.sockets[0].socket.closed).to.equal(true)

    r.fire(RETRY_FIRST_MS)
    await r.settle()
    expect(r.sockets).to.have.length(2)
    expect(r.sockets[1].protocols[1], 'with a new token').to.equal('token-2')
  })

  it('tries again a little later each time, up to a limit, and starts over once it is up', async () => {
    const r = rig()
    r.channel.start()
    const waits: number[] = []
    for (let i = 0; i < 8; i++) {
      await r.settle()
      r.sockets.at(-1)?.socket.emit('close')
      waits.push(r.pending().at(-1)?.ms ?? 0)
      r.pending().at(-1)?.fn()
    }
    expect(waits).to.deep.equal([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
    expect(waits.at(-1)).to.equal(RETRY_LAST_MS)

    await r.settle()
    r.sockets.at(-1)?.socket.emit('open')
    r.sockets.at(-1)?.socket.emit('close')
    expect(r.pending().at(-1)?.ms).to.equal(RETRY_FIRST_MS)
  })

  it('counts an error and a close of the same socket as one loss', async () => {
    const r = await connected()
    r.sockets[0].socket.emit('error')
    r.sockets[0].socket.emit('close')
    expect(r.pending()).to.have.length(1)
    expect(r.world.statuses.filter(status => status === 'offline')).to.have.length(1)
  })

  it('keeps trying while it cannot get a token, and connects when it can', async () => {
    const r = rig()
    r.world.tokenFails = true
    r.channel.start()
    await r.settle()
    expect(r.sockets).to.have.length(0)
    expect(r.channel.status).to.equal('offline')

    r.world.tokenFails = false
    r.fire(RETRY_FIRST_MS)
    await r.settle()
    expect(r.sockets).to.have.length(1)
  })

  it('tries at once when told the device is back, but not while it is up', async () => {
    const r = await connected()
    r.channel.retryNow()
    expect(r.sockets, 'it is up').to.have.length(1)

    r.sockets[0].socket.emit('close')
    r.channel.retryNow()
    await r.settle()
    expect(r.sockets).to.have.length(2)
    expect(
      r.pending().every(timer => timer.ms !== RETRY_FIRST_MS),
      'the wait is given up'
    ).to.equal(true)
  })

  it('closes the socket and stays down when stopped, whatever is still on its way', async () => {
    const r = await connected()
    r.channel.stop()
    expect(r.sockets[0].socket.closed).to.equal(true)
    expect(r.channel.status).to.equal('offline')
    r.sockets[0].socket.emit('close')
    r.sockets[0].socket.emit('message', CHANGED)
    expect(r.pending()).to.have.length(0)
    expect(r.world.changed).to.equal(0)
  })

  it('does not connect if stopped while it was getting the token', async () => {
    const r = rig()
    r.channel.start()
    r.channel.stop()
    await r.settle()
    expect(r.sockets).to.have.length(0)
  })

  it('is not started twice', async () => {
    const r = rig()
    r.channel.start()
    r.channel.start()
    await r.settle()
    expect(r.sockets).to.have.length(1)
  })
})
