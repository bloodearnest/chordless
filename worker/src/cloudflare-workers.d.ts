/** The part of `cloudflare:workers` the Worker uses: a Durable Object base class, and its sockets */
declare module 'cloudflare:workers' {
  interface DurableObjectStorage {
    get<T>(key: string): Promise<T | undefined>
    put(entries: Record<string, unknown>): Promise<void>
    delete(key: string): Promise<boolean>
    deleteAll(): Promise<void>
    list<T>(options: { prefix: string }): Promise<Map<string, T>>
  }
  export interface DurableObjectState {
    storage: DurableObjectStorage
    /** Accept a socket for hibernation: the object may leave memory between its messages */
    acceptWebSocket(socket: WebSocket, tags?: string[]): void
    getWebSockets(tag?: string): WebSocket[]
    /** Answer this message with that one, without waking the object */
    setWebSocketAutoResponse(pair: WebSocketRequestResponsePair): void
  }
  export class DurableObject<E = unknown> {
    ctx: DurableObjectState
    env: E
    constructor(ctx: DurableObjectState, env: E)
  }
}

// (what workerd adds to the standard WebSocket and Response)
interface WebSocket {
  /** What is kept with the socket while the object is out of memory (a small structured value) */
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}
interface ResponseInit {
  webSocket?: WebSocket
}
declare class WebSocketPair {
  0: WebSocket
  1: WebSocket
}
declare class WebSocketRequestResponsePair {
  constructor(request: string, response: string)
}
