/**
 * This device's end of the live channel (docs/LIVE_SYNC.md): one WebSocket to the space's Durable
 * Object, kept up while the device is live. It says "changed" when this device has sent changes to
 * the space, and tells of it when another device does. It carries no content, so when it is down
 * nothing is lost: the minute tick carries on, and a reconnect syncs to catch up.
 *
 * The socket, the clock and the token are injected (`LiveChannelDeps`), so the rules are tested
 * without a network.
 */
import { CHANGED, LIVE_PROTOCOL, PING, PONG } from './live-protocol.ts'

/** Whether the socket is up (offline also covers "waiting to try again") */
export type LiveStatus = 'connecting' | 'connected' | 'offline'

/** The part of a WebSocket that is used */
export interface LiveSocket {
  send(data: string): void
  close(): void
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}

export interface LiveChannelDeps {
  /** A socket to the space's live address, asking for these subprotocols */
  open(protocols: string[]): LiveSocket
  /**
   * What this device proves itself with, asked for at each connection: a team member's ID token
   * (a new one each time: it expires after an hour), a sharer's secret, or null for someone who
   * only listens to a share
   */
  token(): Promise<string | null>
  /** Call `fn` once after `ms`, unless the returned function is called first */
  later(ms: number, fn: () => void): () => void
  /** 0 up to 1, to spread the reconnects of many devices */
  random(): number
}

export interface LiveChannelEvents {
  status(status: LiveStatus): void
  /** Another device sent its changes to the space */
  changed(): void
  /** The socket came up (again): what was missed meanwhile is for a sync to find */
  connected(): void
}

/** How often a ping is sent while connected, and how long its answer is waited for */
export const PING_EVERY_MS = 25_000
export const PONG_WAIT_MS = 10_000
/** The wait before trying again: doubles from the first up to the last */
export const RETRY_FIRST_MS = 1000
export const RETRY_LAST_MS = 30_000

export class LiveChannel {
  #deps: LiveChannelDeps
  #events: LiveChannelEvents
  #status: LiveStatus = 'offline'
  #socket: LiveSocket | null = null
  #stopped = true
  #failures = 0
  #cancel: (() => void) | null = null
  #cancelPong: (() => void) | null = null
  /** Counts the connections, so that a late answer from an old one is ignored */
  #attempt = 0

  constructor(deps: LiveChannelDeps, events: LiveChannelEvents) {
    this.#deps = deps
    this.#events = events
  }

  get status(): LiveStatus {
    return this.#status
  }

  /** Connect, and stay connected (reconnecting when it drops) until `stop` */
  start(): void {
    if (!this.#stopped) return
    this.#stopped = false
    this.#failures = 0
    void this.#connect()
  }

  stop(): void {
    this.#stopped = true
    this.#attempt++
    this.#drop()
    this.#set('offline')
  }

  /** Try now if it is waiting to try again (the device is back online, or the app is shown) */
  retryNow(): void {
    if (this.#stopped || this.#status !== 'offline') return
    this.#cancel?.()
    this.#failures = 0
    void this.#connect()
  }

  /** Tell the other devices this one sent changes; false if the socket is not up (they find it at their tick) */
  notify(): boolean {
    if (this.#status !== 'connected' || !this.#socket) return false
    this.#socket.send(CHANGED)
    return true
  }

  #set(status: LiveStatus): void {
    if (status === this.#status) return
    this.#status = status
    this.#events.status(status)
  }

  #drop(): void {
    this.#cancel?.()
    this.#cancel = null
    this.#cancelPong?.()
    this.#cancelPong = null
    const socket = this.#socket
    this.#socket = null
    socket?.close()
  }

  async #connect(): Promise<void> {
    const attempt = ++this.#attempt
    this.#set('connecting')
    let socket: LiveSocket
    try {
      const token = await this.#deps.token()
      // (stopped, or started again, while the token was being got)
      if (attempt !== this.#attempt) return
      socket = this.#deps.open(token === null ? [LIVE_PROTOCOL] : [LIVE_PROTOCOL, token])
    } catch {
      // (signed out, offline: nothing to hold on to)
      if (attempt === this.#attempt) this.#lost()
      return
    }
    this.#socket = socket

    socket.addEventListener('open', () => {
      if (attempt !== this.#attempt) return
      this.#failures = 0
      this.#set('connected')
      this.#events.connected()
      this.#ping(attempt)
    })
    socket.addEventListener('message', ({ data }) => {
      if (attempt !== this.#attempt) return
      if (data === PONG) {
        this.#cancelPong?.()
        this.#cancelPong = null
      } else if (data === CHANGED) {
        this.#events.changed()
      }
    })
    // (a refused or dropped socket gives an error and then a close, or a close alone: either is a loss)
    const onLoss = () => {
      if (attempt === this.#attempt) this.#lost()
    }
    socket.addEventListener('close', onLoss)
    socket.addEventListener('error', onLoss)
  }

  /** Ask the socket if it is alive after a quiet time; no answer is a dead socket (a phone that changed network) */
  #ping(attempt: number): void {
    this.#cancel = this.#deps.later(PING_EVERY_MS, () => {
      if (attempt !== this.#attempt || !this.#socket) return
      this.#socket.send(PING)
      this.#cancelPong = this.#deps.later(PONG_WAIT_MS, () => {
        if (attempt === this.#attempt) this.#lost()
      })
      this.#ping(attempt)
    })
  }

  /** The socket is gone or never came: try again, a little later each time */
  #lost(): void {
    if (this.#stopped) return
    this.#attempt++
    this.#drop()
    this.#set('offline')
    const wait = Math.min(RETRY_LAST_MS, RETRY_FIRST_MS * 2 ** this.#failures++)
    this.#cancel = this.#deps.later(wait + this.#deps.random() * RETRY_FIRST_MS, () => {
      this.#cancel = null
      void this.#connect()
    })
  }
}
