/**
 * The register of teams (migrations/0001_team_register.sql, docs/SPACES.md, "SongSelect's terms"):
 * which teams use Chordless, who owns them and what CCLI licence they hold, in a D1 table that
 * outlives a team. Kept for compliance (CCLI may ask) and perhaps for charging. It holds what the
 * Worker already holds for a team, never song or pad content and never a member's address.
 *
 * Every write first makes sure the team's row is there and up to date, from what the team's
 * Durable Object says, so a write that was lost (D1 unreachable) is made good by the next one.
 * The writes are best effort: a team works without the register (team-admin.ts).
 */

/** The part of a D1 statement this uses */
export interface RegisterStatement {
  bind(...values: unknown[]): RegisterStatement
}

/** The part of D1 this uses, so a test can give it a SQLite of its own */
export interface RegisterDb {
  prepare(sql: string): RegisterStatement
  /** All or none, in order */
  batch(statements: RegisterStatement[]): Promise<unknown>
}

/** A team as the register knows it: what its Durable Object says of it */
export interface RegisteredTeam {
  spaceId: string
  name: string
  ownerEmail: string
  createdAt: string
}

const UPSERT = `INSERT INTO teams (space_id, name, owner_email, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (space_id) DO UPDATE SET
    name = excluded.name, owner_email = excluded.owner_email, updated_at = excluded.updated_at`

const EVENT =
  'INSERT INTO team_events (space_id, at, kind, by_email, detail) VALUES (?, ?, ?, ?, ?)'

export class TeamRegister {
  #db: RegisterDb
  #now: () => Date

  constructor(db: RegisterDb, now: () => Date = () => new Date()) {
    this.#db = db
    this.#now = now
  }

  /** The team's row, then these statements, in one go */
  #write(team: RegisteredTeam, ...after: ((at: string) => RegisterStatement)[]): Promise<unknown> {
    const at = this.#now().toISOString()
    return this.#db.batch([
      this.#db
        .prepare(UPSERT)
        .bind(team.spaceId, team.name, team.ownerEmail.toLowerCase(), team.createdAt, at),
      ...after.map(statement => statement(at)),
    ])
  }

  #event(team: RegisteredTeam, kind: string, by: string, detail?: object) {
    return (at: string) =>
      this.#db
        .prepare(EVENT)
        .bind(team.spaceId, at, kind, by.toLowerCase(), detail ? JSON.stringify(detail) : null)
  }

  #set(team: RegisteredTeam, column: 'ccli_licence' | 'members' | 'ended_at', value: unknown) {
    return () =>
      this.#db
        .prepare(`UPDATE teams SET ${column} = ? WHERE space_id = ?`)
        .bind(value, team.spaceId)
  }

  /** A team was made (with its licence number, if one was given) */
  created(team: RegisteredTeam, by: string, licence: string | null, members: number) {
    return this.#write(
      team,
      this.#event(team, 'created', by),
      this.#set(team, 'members', members),
      ...(licence
        ? [
            this.#set(team, 'ccli_licence', licence),
            this.#event(team, 'licence', by, { from: null, to: licence }),
          ]
        : [])
    )
  }

  /** The team's licence number was set, changed or cleared */
  licence(team: RegisteredTeam, by: string, from: string | null, to: string | null) {
    return this.#write(
      team,
      this.#set(team, 'ccli_licence', to),
      this.#event(team, 'licence', by, { from, to })
    )
  }

  /** The team has this many people now (the owner included) */
  members(team: RegisteredTeam, count: number) {
    return this.#write(team, this.#set(team, 'members', count))
  }

  /** Sharing ended: the team stays in the register, marked */
  ended(team: RegisteredTeam, by: string) {
    return this.#write(
      team,
      this.#set(team, 'ended_at', this.#now().toISOString()),
      this.#event(team, 'ended', by)
    )
  }
}
