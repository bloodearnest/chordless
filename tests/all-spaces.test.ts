/** Setlists across spaces (all-spaces.ts): listed with their space, and found by id alone */
import { expect } from '@open-wc/testing'
import { findSetlistSpace, listAllSetlists } from '../src/js/all-spaces.ts'
import type { Setlist, Space } from '../src/js/data-types.ts'
import { createSetlist, openSpace } from '../src/js/db.ts'
import { setDefaultSpaceId } from '../src/js/default-space.ts'
import { createSpace, deleteSpace } from '../src/js/space.ts'

const { describe, it, beforeEach, afterEach } = window

describe('Setlists across spaces', () => {
  let a: Space
  let b: Space
  let inA: string
  let inB: string

  beforeEach(async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    a = await createSpace(`All A ${tag}`)
    b = await createSpace(`All B ${tag}`)
    inA = (await (await openSpace(a.id)).saveSetlist(createSetlist({ name: 'In A' }))).id
    inB = (await (await openSpace(b.id)).saveSetlist(createSetlist({ name: 'In B' }))).id
  })

  afterEach(async () => {
    await deleteSpace(a.id)
    await deleteSpace(b.id)
  })

  it('lists the setlists of every space with the space each is in', async () => {
    const all = await listAllSetlists([a, b])
    expect(all.map(entry => [entry.setlist.id, entry.space.id])).to.have.deep.members([
      [inA, a.id],
      [inB, b.id],
    ])
  })

  it('reads the spaces of the device when not given them', async () => {
    const all = await listAllSetlists()
    expect(all.map(entry => entry.setlist.id)).to.include.members([inA, inB])
    expect((await findSetlistSpace(inB))?.id).to.equal(b.id)
  })

  it('takes the default space’s copy of a setlist that two spaces have', async () => {
    const copy = { ...(await (await openSpace(a.id)).getSetlist(inA)) } as Setlist
    await (await openSpace(b.id)).saveSetlist(copy)
    setDefaultSpaceId(b.id)
    try {
      expect((await findSetlistSpace(inA, [a, b]))?.id).to.equal(b.id)
    } finally {
      setDefaultSpaceId(null)
    }
  })

  it('finds the space of a setlist from its id alone', async () => {
    expect((await findSetlistSpace(inA, [a, b]))?.id).to.equal(a.id)
    expect((await findSetlistSpace(inB, [a, b]))?.id).to.equal(b.id)
    expect(await findSetlistSpace('nope', [a, b])).to.equal(undefined)
  })
})
