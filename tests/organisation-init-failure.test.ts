/**
 * Opening the organisations database when the browser cannot. (It is opened once per page and kept,
 * so this is in a file of its own; see organisation-init.test.ts.)
 */
import { expect } from '@open-wc/testing'
import { listOrganisations } from '../src/js/organisation.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('opening the organisations database, failing', () => {
  it('fails, and can be tried again, when the browser cannot open it', async () => {
    const realOpen = indexedDB.open
    const realError = console.error
    console.error = () => {}
    indexedDB.open = (() => {
      const request = {} as IDBOpenDBRequest
      setTimeout(() => (request.onerror as () => void)(), 0)
      return request
    }) as typeof indexedDB.open
    try {
      let thrown: Error | undefined
      try {
        await listOrganisations()
      } catch (error) {
        thrown = error as Error
      }
      expect(thrown?.message).to.contain('Failed to open Organisations IndexedDB: Unknown error')
    } finally {
      indexedDB.open = realOpen
      console.error = realError
    }

    expect(await listOrganisations()).to.be.an('array')
  })
})
