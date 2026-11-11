/**
 * Cloudflare D1 for a test that runs in the browser (worker/src/d1.ts): the SQLite of the node tests
 * (d1-db.ts) runs on the server side of Web Test Runner (scripts/wtr-d1-plugin.js), and each
 * statement is sent to it.
 */
import { executeServerCommand } from '@web/test-runner-commands'
import type { D1Db, D1Result, D1Statement } from '../worker/src/d1.ts'

type Mode = 'run' | 'all' | 'first'

/** A database with the migrations applied */
export async function browserD1(): Promise<D1Db> {
  const id = await executeServerCommand<string, undefined>('d1-open')

  class Statement implements D1Statement {
    sql: string
    values: unknown[] = []
    constructor(sql: string) {
      this.sql = sql
    }
    bind(...values: unknown[]) {
      this.values = values
      return this
    }
    async #ask<T>(mode: Mode): Promise<T> {
      const answer = await executeServerCommand<{ value: T }, unknown>('d1-statement', {
        id,
        sql: this.sql,
        values: this.values,
        mode,
      })
      return answer.value
    }
    run() {
      return this.#ask<D1Result>('run')
    }
    all<T>() {
      return this.#ask<D1Result<T>>('all')
    }
    first<T>() {
      return this.#ask<T | null>('first')
    }
  }

  return {
    prepare: sql => new Statement(sql),
    batch: async statements =>
      (
        await executeServerCommand<{ value: D1Result[] }, unknown>('d1-batch', {
          id,
          statements: (statements as Statement[]).map(({ sql, values }) => ({ sql, values })),
        })
      ).value,
  }
}
