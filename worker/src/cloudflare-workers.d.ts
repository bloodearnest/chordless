/** The part of `cloudflare:workers` the Worker uses: a Durable Object base class */
declare module 'cloudflare:workers' {
  interface DurableObjectStorage {
    get<T>(key: string): Promise<T | undefined>
    put(entries: Record<string, unknown>): Promise<void>
    delete(key: string): Promise<boolean>
    list<T>(options: { prefix: string }): Promise<Map<string, T>>
  }
  interface DurableObjectState {
    storage: DurableObjectStorage
  }
  export class DurableObject<E = unknown> {
    ctx: DurableObjectState
    env: E
    constructor(ctx: DurableObjectState, env: E)
  }
}
