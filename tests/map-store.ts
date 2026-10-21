import type { Store } from '../worker/src/team-state.ts'

/** A Durable Object's storage, in memory; it counts the puts and keeps what they held */
export class MapStore implements Store {
  entries = new Map<string, unknown>()
  puts: string[][] = []

  async get<T>(key: string) {
    return this.entries.get(key) as T | undefined
  }
  async put(entries: Record<string, unknown>) {
    this.puts.push(Object.keys(entries))
    for (const [key, value] of Object.entries(entries)) this.entries.set(key, value)
  }
  async deleteAll() {
    this.entries.clear()
  }
  async delete(key: string) {
    return this.entries.delete(key)
  }
  async list<T>({ prefix }: { prefix: string }) {
    return new Map([...this.entries].filter(([key]) => key.startsWith(prefix)) as [string, T][])
  }
}
