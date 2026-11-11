/**
 * The register of teams' database for a test (worker/src/team-register.ts): D1's shape over a SQLite
 * of our own (node:sqlite), with the migrations in migrations/ applied as they stand.
 */
import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { RegisterDb, RegisterStatement } from '../worker/src/team-register.ts'

export function registerDb(): { db: RegisterDb; sql: DatabaseSync; fail(on: boolean): void } {
  const sql = new DatabaseSync(':memory:')
  sql.exec(readFileSync(new URL('../migrations/0001_team_register.sql', import.meta.url), 'utf8'))
  let failing = false
  class Statement implements RegisterStatement {
    text: string
    values: SQLInputValue[] = []
    constructor(text: string) {
      this.text = text
    }
    bind(...values: unknown[]) {
      this.values = values as SQLInputValue[]
      return this
    }
  }
  const db: RegisterDb = {
    prepare: text => new Statement(text),
    async batch(statements) {
      if (failing) throw new Error('D1 is down')
      sql.exec('BEGIN')
      try {
        for (const each of statements as Statement[]) sql.prepare(each.text).run(...each.values)
        sql.exec('COMMIT')
      } catch (error) {
        sql.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { db, sql, fail: on => (failing = on) }
}
