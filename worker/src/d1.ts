/** The part of Cloudflare D1 the Worker uses, so a test can give it a SQLite of its own */

export interface D1Result<T = unknown> {
  results: T[]
  meta: { changes: number }
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement
  run(): Promise<D1Result>
  all<T = unknown>(): Promise<D1Result<T>>
  first<T = unknown>(): Promise<T | null>
}

export interface D1Db {
  prepare(sql: string): D1Statement
  /** All or none, in order; the answers are in order too */
  batch(statements: D1Statement[]): Promise<D1Result[]>
}
