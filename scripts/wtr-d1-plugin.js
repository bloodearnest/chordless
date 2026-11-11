// A SQLite for the browser tests of the Worker's D1 code (tests/d1-browser.ts): the page cannot run
// node:sqlite, so its statements are run here and the answers sent back. Each database is made with
// the migrations in migrations/ applied (tests/d1-db.ts), as the node tests have it.
import { d1Db } from '../tests/d1-db.ts'

export function d1Plugin() {
  const databases = new Map()
  let made = 0
  return {
    name: 'd1',
    async executeCommand({ command, payload }) {
      if (command === 'd1-open') {
        const id = String(++made)
        databases.set(id, d1Db().db)
        return id
      }
      if (command === 'd1-statement') {
        const { id, sql, values, mode } = payload
        // (wrapped: a null answer, no row, would be taken for a command nobody handled)
        const statement = databases
          .get(id)
          .prepare(sql)
          .bind(...values)
        return { value: await statement[mode]() }
      }
      if (command === 'd1-batch') {
        const db = databases.get(payload.id)
        const statements = payload.statements.map(({ sql, values }) =>
          db.prepare(sql).bind(...values)
        )
        return { value: await db.batch(statements) }
      }
      return undefined
    },
  }
}
