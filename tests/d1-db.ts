/**
 * Cloudflare D1 for a test (worker/src/d1.ts): its shape over a SQLite of our own (node:sqlite), with
 * the migrations in migrations/ applied in order, as they stand. So the SQL and the schema of the
 * team spaces and the register of teams are tested together.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { D1Db, D1Result, D1Statement } from '../worker/src/d1.ts'

const MIGRATIONS = new URL('../migrations/', import.meta.url)

/** A database with the migrations applied; `fail(true)` makes it throw, as D1 does when it is down */
export function d1Db(): { db: D1Db; sql: DatabaseSync; fail(on: boolean): void } {
  const sql = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).sort()) {
    sql.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
  let failing = false

  class Statement implements D1Statement {
    text: string
    values: SQLInputValue[] = []
    constructor(text: string) {
      this.text = text
    }
    bind(...values: unknown[]) {
      this.values = values as SQLInputValue[]
      return this
    }
    #check() {
      if (failing) throw new Error('D1 is down')
    }
    execute<T>(): D1Result<T> {
      this.#check()
      const statement = sql.prepare(this.text)
      if (statement.columns().length > 0) {
        const results = statement.all(...this.values).map(row => ({ ...row })) as T[]
        return { results, meta: { changes: 0 } }
      }
      const { changes } = statement.run(...this.values)
      return { results: [], meta: { changes: Number(changes) } }
    }
    async run() {
      return this.execute()
    }
    async all<T>() {
      return this.execute<T>()
    }
    async first<T>() {
      return (this.execute<T>().results[0] as T | undefined) ?? null
    }
  }

  const db: D1Db = {
    prepare: text => new Statement(text),
    async batch(statements) {
      if (failing) throw new Error('D1 is down')
      sql.exec('BEGIN')
      try {
        const answers = (statements as Statement[]).map(each => each.execute())
        sql.exec('COMMIT')
        return answers
      } catch (error) {
        sql.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { db, sql, fail: on => (failing = on) }
}
