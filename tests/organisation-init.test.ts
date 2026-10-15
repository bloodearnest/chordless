/**
 * Opening the organisations database for the first time. It is opened once per page and kept, so
 * these run in files of their own (a page is new for each file), where nothing has opened it
 * before.
 */
import { expect } from '@open-wc/testing'
import { listOrganisations } from '../src/js/organisation.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('opening the organisations database', () => {
  it('is opened once when two things ask for it at the same time', async () => {
    const [first, second] = await Promise.all([listOrganisations(), listOrganisations()])
    expect(second).to.deep.equal(first)
  })
})
