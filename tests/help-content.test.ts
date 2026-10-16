import { expect } from '@open-wc/testing'
import { type HelpSection, helpFor } from '../src/js/help-content.ts'
import type { Route } from '../src/js/router.ts'

const { describe, it } = window

describe('helpFor', () => {
  it('has the overview help for a setlist or share overview, and the song help for a song', () => {
    for (const route of [
      { name: 'setlist', setlistId: 'a', songIndex: -1 },
      { name: 'share', fileId: 'f', songIndex: -1 },
    ] as const satisfies Route[])
      expect(helpFor(route)?.title).to.equal('Setlist Overview')
    for (const route of [
      { name: 'setlist', setlistId: 'a', songIndex: 0 },
      { name: 'setlist', setlistId: 'a', songIndex: 2 },
      { name: 'share', fileId: 'f', songIndex: 1 },
    ] as const satisfies Route[])
      expect(helpFor(route)?.title).to.equal('Setlist Song')
  })

  it('has the library help for the song library, searched or on a song', () => {
    for (const route of [
      { name: 'songs' },
      { name: 'songs', search: 'grace' },
      { name: 'songs', songUuid: 'u' },
    ] as const satisfies Route[])
      expect(helpFor(route)?.title).to.equal('Song Library')
  })

  it('has none yet for the other pages', () => {
    for (const route of [
      { name: 'home' },
      { name: 'about' },
      { name: 'not-found', path: '/x' },
    ] as const satisfies Route[])
      expect(helpFor(route)).to.equal(undefined)
    expect(helpFor(null)).to.equal(undefined)
  })

  it('has sections with something to say', () => {
    for (const route of [
      { name: 'songs' },
      { name: 'setlist', setlistId: 'a', songIndex: -1 },
      { name: 'setlist', setlistId: 'a', songIndex: 0 },
    ] as const satisfies Route[]) {
      const page = helpFor(route)
      expect(page?.intro.length, page?.title).to.be.greaterThan(0)
      for (const section of page?.sections ?? []) checkSection(section)
    }
  })
})

function checkSection(section: HelpSection) {
  expect(section.heading).to.not.equal('')
  for (const item of section.items ?? []) {
    expect(item.text).to.not.equal('')
  }
}
