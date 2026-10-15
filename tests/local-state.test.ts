import { expect } from '@open-wc/testing'
import {
  clearSetlistLocalState,
  loadSetlistLocalState,
  saveSetlistLocalState,
} from '../src/js/setlist/local-state.ts'

const hidden = { hideMode: 'hide', isCollapsed: false, isHidden: true } as const

describe('what a setlist keeps on this device', () => {
  beforeEach(() => localStorage.removeItem('state-s1'))
  afterEach(() => localStorage.removeItem('state-s1'))

  it('is nothing until it is kept, and then what was kept', () => {
    expect(loadSetlistLocalState('s1')).to.deep.equal({ sectionState: {}, capoValues: {} })
    saveSetlistLocalState('s1', { sectionState: { 0: { 1: hidden } }, capoValues: { 2: 4 } })
    expect(loadSetlistLocalState('s1')).to.deep.equal({
      sectionState: { 0: { 1: hidden } },
      capoValues: { 2: 4 },
    })
  })

  it('reads the older formats: sections at the top, and the capos as capo', () => {
    localStorage.setItem('state-s1', JSON.stringify({ 0: { 1: hidden }, capo: { 3: 2 } }))
    expect(loadSetlistLocalState('s1')).to.deep.equal({
      sectionState: { 0: { 1: hidden } },
      capoValues: { 3: 2 },
    })
  })

  it('is nothing when what was kept cannot be read', () => {
    localStorage.setItem('state-s1', '{not json')
    expect(loadSetlistLocalState('s1')).to.deep.equal({ sectionState: {}, capoValues: {} })
  })

  it('carries on when it cannot be kept, as when storage is full', () => {
    const realSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    try {
      expect(() => saveSetlistLocalState('s1', { sectionState: {}, capoValues: {} })).to.not.throw()
    } finally {
      Storage.prototype.setItem = realSetItem
    }
  })

  it('is forgotten when the setlist is deleted', () => {
    saveSetlistLocalState('s1', { sectionState: {}, capoValues: { 0: 1 } })
    clearSetlistLocalState('s1')
    expect(localStorage.getItem('state-s1')).to.equal(null)
  })
})
