import { expect } from '@open-wc/testing'
import type { Space } from '../src/js/data-types.ts'
import {
  bySpaceAge,
  defaultSpaceOf,
  getDefaultSpaceId,
  importTargetOf,
  setDefaultSpaceId,
} from '../src/js/default-space.ts'

const { describe, it, afterEach } = window

const space = (id: string, extra: Partial<Space> = {}): Space => ({
  id,
  name: id,
  createdDate: `2026-01-0${id.length}T00:00:00.000Z`,
  modifiedDate: '',
  ...extra,
})
const team = (id: string, extra: Partial<Space> = {}) =>
  space(id, { team: { id: `t-${id}`, role: 'writer' }, ...extra })

describe('the default space', () => {
  afterEach(() => setDefaultSpaceId(null))

  it('orders spaces by when they were made, and two made in the same moment by their ids', () => {
    const at = '2026-01-01T00:00:00.000Z'
    const made = [
      { ...space('b'), createdDate: at },
      { ...space('a'), createdDate: at },
      { ...space('c'), createdDate: '2025-12-31T00:00:00.000Z' },
    ]
    expect(made.sort(bySpaceAge).map(each => each.id)).to.deep.equal(['c', 'a', 'b'])
  })

  it('is kept in this browser, and forgotten', () => {
    expect(getDefaultSpaceId()).to.equal(null)
    setDefaultSpaceId('a')
    expect(getDefaultSpaceId()).to.equal('a')
    setDefaultSpaceId(null)
    expect(getDefaultSpaceId()).to.equal(null)
  })

  it('is the one chosen, if the device still has it', () => {
    const spaces = [team('bb'), space('a')]
    expect(defaultSpaceOf(spaces, 'a')?.id).to.equal('a')
    expect(defaultSpaceOf(spaces, 'gone')?.id).to.equal('bb')
  })

  it('is the first Team made when none was chosen, else the first space', () => {
    // (made in the order a, bb, ccc)
    expect(defaultSpaceOf([space('a'), team('ccc'), team('bb')], null)?.id).to.equal('bb')
    expect(defaultSpaceOf([space('ccc'), space('a')], null)?.id).to.equal('a')
    expect(defaultSpaceOf([], null)).to.equal(undefined)
  })

  it('reads the choice from this browser when it is not given one', () => {
    setDefaultSpaceId('a')
    expect(defaultSpaceOf([team('bb'), space('a')])?.id).to.equal('a')
  })

  it('is where imports from outside go: the default, unless it can only be read', () => {
    const spaces = [space('a'), team('bb', { readOnly: true }), team('ccc')]
    expect(importTargetOf(spaces, 'a')?.id).to.equal('a')
    // (a Team's member who is not a worship leader cannot add to it: the next Team they can write to)
    expect(importTargetOf(spaces, 'bb')?.id).to.equal('ccc')
    expect(importTargetOf(spaces, null)?.id).to.equal('ccc')
    // (no Team to write to: any space they can)
    expect(importTargetOf([space('a'), team('bb', { readOnly: true })], 'bb')?.id).to.equal('a')
    // (nothing to write to at all: the default, so there is somewhere to say why not)
    expect(importTargetOf([team('bb', { readOnly: true })], 'bb')?.id).to.equal('bb')
    expect(importTargetOf([], null)).to.equal(undefined)
  })

  it('is worked out as if none was chosen when storage is blocked', () => {
    const real = Storage.prototype.getItem
    const set = Storage.prototype.setItem
    Storage.prototype.getItem = () => {
      throw new Error('blocked')
    }
    Storage.prototype.setItem = () => {
      throw new Error('blocked')
    }
    try {
      expect(getDefaultSpaceId()).to.equal(null)
      setDefaultSpaceId('a')
      expect(defaultSpaceOf([space('a'), team('bb')])?.id).to.equal('bb')
    } finally {
      Storage.prototype.getItem = real
      Storage.prototype.setItem = set
    }
  })
})
