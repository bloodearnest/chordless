/**
 * A picture of the D1 schema, generated from the migrated database (docs/SCHEMA_RULES.md, "The diagram"):
 *
 *   node scripts/schema-svg.ts docs/D1_SCHEMA_0019.svg --since 0019
 *   just schema-diagram 0019
 *
 * Every migration is applied to a SQLite database (as the tests do) and each table is drawn with its columns,
 * primary key, foreign keys (with their ON DELETE rule) and indexes. Parents are to the left.
 *
 * `--since 0019` marks what the migrations from 0019 on **add or change** in orange: the whole of a new
 * table, and the columns and indexes of an existing table that are new or differ from before. A table the
 * migrations drop is named in the heading. That is the convention for a pull request that changes the schema:
 * regenerate the picture with its migration marked, so the reviewer sees what it does.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

interface Column {
  name: string
  type: string
  notnull: number
  pk: number
  dflt_value: string | null
}
interface ForeignKey {
  from: string
  table: string
  on_delete: string
}
interface Table {
  columns: Column[]
  foreignKeys: ForeignKey[]
  indexes: string[]
  checks: number
  flags: string
}

const DIRECTORY = new URL('../migrations/', import.meta.url)
const ORANGE = '#d9822b'
const WIDTH = 330
const GAP_X = 120
const GAP_Y = 26
const ROW = 15
const HEAD = 24
const LEFT = 170

function migrated(files: string[]): Map<string, Table> {
  const sql = new DatabaseSync(':memory:')
  for (const file of files) sql.exec(readFileSync(new URL(file, DIRECTORY), 'utf8'))
  const tableList = sql.prepare('PRAGMA table_list').all() as unknown as {
    name: string
    strict: number
    wr: number
  }[]
  const tables = new Map<string, Table>()
  const rows = sql
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations', '_account_backfill') ORDER BY name"
    )
    .all() as unknown as { name: string; sql: string }[]
  for (const { name, sql: ddl } of rows) {
    const indexes = (
      sql.prepare(`PRAGMA index_list("${name}")`).all() as unknown as {
        name: string
        unique: number
        origin: string
        partial: number
      }[]
    )
      .filter(index => index.origin !== 'pk')
      .map(index => {
        const columns = (
          sql.prepare(`PRAGMA index_info("${index.name}")`).all() as unknown as { name: string }[]
        )
          .map(column => column.name)
          .join(', ')
        const label = index.origin === 'u' ? '' : `${index.name.replace(`${name}_`, '')} `
        return `${index.unique ? 'unique ' : ''}${label}(${columns})${index.partial ? ' where…' : ''}`.trim()
      })
    const listed = tableList.find(table => table.name === name)
    tables.set(name, {
      columns: sql.prepare(`PRAGMA table_info("${name}")`).all() as unknown as Column[],
      foreignKeys: sql
        .prepare(`PRAGMA foreign_key_list("${name}")`)
        .all() as unknown as ForeignKey[],
      indexes,
      checks: (ddl.match(/\bCHECK\b/g) ?? []).length,
      flags: [listed?.strict ? 'STRICT' : '', listed?.wr ? 'WITHOUT ROWID' : '']
        .filter(Boolean)
        .join(', '),
    })
  }
  return tables
}

/** What is new in a table, or differs from before: its columns and indexes, by name */
function changes(now: Table, before: Table | undefined) {
  const describe = (table: Table, column: Column) => {
    const key = table.foreignKeys.find(fk => fk.from === column.name)
    return JSON.stringify([
      column.type,
      column.notnull,
      column.pk,
      column.dflt_value,
      key?.table,
      key?.on_delete,
    ])
  }
  const columns = new Set(
    now.columns
      .filter(column => {
        const old = before?.columns.find(candidate => candidate.name === column.name)
        return !old || describe(before as Table, old) !== describe(now, column)
      })
      .map(column => column.name)
  )
  const indexes = new Set(now.indexes.filter(index => !before?.indexes.includes(index)))
  return { columns, indexes }
}

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const colour = (rule: string) =>
  rule === 'CASCADE' ? '#2e8b57' : rule === 'SET NULL' ? '#c27a1a' : '#7a2a22'

function layers(tables: Map<string, Table>): string[][] {
  const depth = new Map<string, number>()
  const find = (name: string, seen: Set<string>): number => {
    const known = depth.get(name)
    if (known !== undefined) return known
    if (seen.has(name)) return 0
    seen.add(name)
    const parents = (tables.get(name)?.foreignKeys ?? [])
      .map(fk => fk.table)
      .filter(parent => parent !== name && tables.has(parent))
    const value = parents.length ? 1 + Math.max(...parents.map(parent => find(parent, seen))) : 0
    depth.set(name, value)
    return value
  }
  const result: string[][] = []
  for (const name of tables.keys()) {
    const level = find(name, new Set())
    result[level] = [...(result[level] ?? []), name]
  }
  return result.filter(Boolean)
}

function draw(files: string[], since: string | null): string {
  const tables = migrated(files)
  const baseline = since ? migrated(files.filter(file => file < since)) : tables
  const columns = layers(tables)
  const place = new Map<string, { x: number; y: number; h: number }>()
  let bottom = 0
  columns.forEach((names, index) => {
    let y = 90
    for (const name of names) {
      const table = tables.get(name) as Table
      const h =
        HEAD +
        table.columns.length * ROW +
        (table.indexes.length ? 6 + table.indexes.length * 13 : 0) +
        8
      place.set(name, { x: LEFT + index * (WIDTH + GAP_X), y, h })
      y += h + GAP_Y
    }
    bottom = Math.max(bottom, y)
  })
  const width = LEFT + columns.length * (WIDTH + GAP_X) - GAP_X + 40
  const height = bottom + 30
  const dropped = [...baseline.keys()].filter(name => !tables.has(name))
  const added = [...tables.keys()].filter(name => !baseline.has(name))
  const altered = [...tables.keys()].filter(name => {
    const before = baseline.get(name)
    if (!before) return false
    const { columns: c, indexes: i } = changes(tables.get(name) as Table, before)
    return c.size + i.size > 0
  })

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Helvetica, Arial, sans-serif"><rect width="${width}" height="${height}" fill="#fafbfc"/>\n`
  svg += `<text x="30" y="34" font-size="21" font-weight="700" fill="#1b2733">Chordless D1 schema after ${xml(files.at(-1) ?? '')}</text>\n`
  svg += `<text x="30" y="52" font-size="12" fill="#5d6b78">Generated from the migrated database (${files.length} migrations, ${tables.size} tables). ? = nullable, ◆ = primary key. Lines run from a foreign key to the row it names: green cascade, orange set null, red restrict. Parents are to the left.</text>\n`
  if (since) {
    const bits = [
      added.length ? `new: ${added.join(', ')}` : '',
      altered.length ? `changed: ${altered.join(', ')}` : '',
      dropped.length ? `dropped: ${dropped.join(', ')}` : '',
    ].filter(Boolean)
    svg += `<rect x="30" y="62" width="12" height="12" rx="2" fill="${ORANGE}"/><text x="48" y="73" font-size="12" font-weight="700" fill="${ORANGE}">Added or changed by migrations ${xml(since.slice(0, 4))} on · ${xml(bits.join(' · '))}</text>\n`
  }
  for (const [name, table] of tables) {
    const at = place.get(name) as { x: number; y: number }
    for (const fk of table.foreignKeys) {
      const target = place.get(fk.table)
      if (!target || fk.table === name) continue
      const row = table.columns.findIndex(column => column.name === fk.from)
      const y1 = at.y + HEAD + row * ROW + ROW / 2
      const y2 = target.y + HEAD / 2
      const toLeft = target.x < at.x
      const x1 = toLeft ? at.x : at.x + WIDTH
      const x2 = toLeft ? target.x + WIDTH : target.x
      const bend = (toLeft ? -1 : 1) * GAP_X * 0.45
      const line = colour(fk.on_delete)
      svg += `<path d="M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}" fill="none" stroke="${line}" stroke-width="1.3" opacity="0.7"/><circle cx="${x2}" cy="${y2}" r="3" fill="${line}"/>\n`
    }
  }
  for (const [name, table] of tables) {
    const at = place.get(name) as { x: number; y: number; h: number }
    const isNew = since !== null && !baseline.has(name)
    const diff = since !== null && baseline.has(name) ? changes(table, baseline.get(name)) : null
    const head = isNew ? ORANGE : '#3f6fb0'
    svg += `<rect x="${at.x}" y="${at.y}" width="${WIDTH}" height="${at.h}" rx="5" fill="#fff" stroke="${isNew ? ORANGE : '#c9d1d9'}" stroke-width="${isNew ? 1.6 : 1}"/>\n`
    svg += `<rect x="${at.x}" y="${at.y}" width="${WIDTH}" height="${HEAD}" rx="5" fill="${head}"/><rect x="${at.x}" y="${at.y + HEAD - 6}" width="${WIDTH}" height="6" fill="${head}"/>\n`
    const note = [
      table.flags,
      table.checks ? `${table.checks} check${table.checks > 1 ? 's' : ''}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    svg += `<text x="${at.x + 8}" y="${at.y + 16}" font-size="13" font-weight="700" fill="#fff">${xml(name)}${isNew ? ' (new)' : diff && (diff.columns.size || diff.indexes.size) ? ' (changed)' : ''}</text><text x="${at.x + WIDTH - 8}" y="${at.y + 16}" font-size="9.5" fill="#fff" fill-opacity="0.8" text-anchor="end">${xml(note)}</text>\n`
    table.columns.forEach((column, index) => {
      const y = at.y + HEAD + index * ROW + 11
      const fk = table.foreignKeys.find(candidate => candidate.from === column.name)
      const marked = isNew || diff?.columns.has(column.name)
      if (marked && !isNew)
        svg += `<rect x="${at.x + 2}" y="${y - 11}" width="${WIDTH - 4}" height="${ROW}" fill="#fff1dc"/>`
      const ink = marked ? '#a8590f' : column.pk ? '#1b2733' : '#3a4753'
      svg += `<text x="${at.x + 8}" y="${y}" font-size="10.5" fill="${ink}" font-weight="${column.pk || marked ? 700 : 400}">${column.pk ? '◆ ' : ''}${xml(column.name)}${column.notnull || column.pk ? '' : '?'}</text>`
      svg += `<text x="${at.x + 168}" y="${y}" font-size="10" fill="${marked ? '#a8590f' : '#6b7885'}">${xml(column.type.toLowerCase())}</text>`
      if (fk)
        svg += `<text x="${at.x + WIDTH - 8}" y="${y}" font-size="9.5" fill="${colour(fk.on_delete)}" text-anchor="end">→ ${xml(fk.table)}</text>`
      svg += '\n'
    })
    table.indexes.forEach((index, i) => {
      const marked = isNew || diff?.indexes.has(index)
      svg += `<text x="${at.x + 8}" y="${at.y + HEAD + table.columns.length * ROW + 16 + i * 13}" font-size="9" fill="${marked ? '#a8590f' : '#8a96a2'}">idx ${xml(index)}</text>\n`
    })
  }
  return `${svg}</svg>\n`
}

const [output, flag, since] = process.argv.slice(2)
if (!output || (flag !== undefined && (flag !== '--since' || !/^\d{4}$/.test(since ?? '')))) {
  console.error('Usage: node scripts/schema-svg.ts <out.svg> [--since 0019]')
  process.exit(2)
}
const files = readdirSync(DIRECTORY)
  .filter(file => file.endsWith('.sql'))
  .sort()
writeFileSync(output, draw(files, since ?? null))
console.log(`${output}: ${files.length} migrations`)
