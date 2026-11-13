import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { copySheetsInto, sheetsToCopyInto } from '../src/js/lead-sheets-elsewhere.ts'
import { scoreRecord } from '../src/js/score-record.ts'
import { addChart } from '../src/js/song-utils.ts'
import { createSpace, deleteSpace } from '../src/js/space.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const ALPHA = '{title: Alpha}\n{key: G}\n[G]Alpha line'
const BETA = '{title: Beta}\n{key: D}\n[D]Beta line'
const ADD = { variantLabel: 'Test', importSource: 'test', makeDefault: 'first' } as const
const SHEET = '<score-partwise>personal</score-partwise>'

describe('Lead sheets that other spaces hold', () => {
  const name = () => `Lead sheets ${crypto.randomUUID().slice(0, 8)}`
  let personal: Awaited<ReturnType<typeof createSpace>>
  let team: Awaited<ReturnType<typeof createSpace>>
  let personalDb: ChordlessDB
  let teamDb: ChordlessDB

  beforeEach(async () => {
    personal = await createSpace(name())
    team = await createSpace(name())
    personalDb = new ChordlessDB(personal.id)
    await personalDb.init()
    teamDb = new ChordlessDB(team.id)
    await teamDb.init()
  })

  afterEach(async () => {
    personalDb.db?.close()
    teamDb.db?.close()
    await deleteDatabase(personal.id)
    await deleteDatabase(team.id)
    await deleteSpace(personal.id)
    await deleteSpace(team.id)
  })

  /** A song in both spaces, as a Team made from an export has it: the same chart, another uuid, and the sheet only in the personal space */
  async function sheetOnlyInPersonal(chart: string) {
    const mine = await addChart(personalDb, chart, ADD)
    await personalDb.saveScore(scoreRecord(mine.uuid, SHEET, 'G'))
    return addChart(teamDb, chart, ADD)
  }

  it('counts the songs that lack a sheet another space has', async () => {
    await sheetOnlyInPersonal(ALPHA)
    await addChart(teamDb, BETA, ADD)
    expect(await sheetsToCopyInto(team.id)).to.equal(1)
  })

  it('counts nothing when no other space has one, or the song has its own', async () => {
    const alpha = await sheetOnlyInPersonal(ALPHA)
    await teamDb.saveScore(scoreRecord(alpha.uuid, '<score-partwise>own</score-partwise>', 'G'))
    expect(await sheetsToCopyInto(team.id)).to.equal(0)
    // (and the personal space has none to take from the team)
    expect(await sheetsToCopyInto(personal.id)).to.equal(0)
  })

  it('copies them, once, and takes nothing from the space they come from', async () => {
    const alpha = await sheetOnlyInPersonal(ALPHA)

    expect(await copySheetsInto(team.id)).to.equal(1)

    const copied = must(await teamDb.getScore(alpha.uuid))
    expect(copied.xml).to.equal(SHEET)
    expect(copied.key).to.equal('G')
    expect(await personalDb.getAllScores()).to.have.length(1)
    expect(await sheetsToCopyInto(team.id)).to.equal(0)
    expect(await copySheetsInto(team.id)).to.equal(0)
  })
})
