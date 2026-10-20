import { expect } from '@open-wc/testing'
import {
  createSpace,
  deleteSpace as deleteSpaceAndData,
  ensureCurrentSpace,
  getCurrentSpace,
  getCurrentSpaceFull,
  getSpaceByName,
  listSpaces,
  migrateLegacyKeys,
  renameSpace,
  setCurrentSpace,
  switchSpace,
} from '../src/js/space.ts'
import { SpaceDB } from '../src/js/space-db.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

// Other test files, run alongside these, use the current space's
// database: put it back after each test that changes it
const KEYS = ['current-space-id', 'current-space-name']
let saved
beforeEach(() => {
  saved = KEYS.map(key => localStorage.getItem(key))
})
afterEach(() => {
  KEYS.forEach((key, i) => {
    if (saved[i] === null) localStorage.removeItem(key)
    else localStorage.setItem(key, saved[i])
  })
})

describe('ensureCurrentSpace', () => {
  beforeEach(async () => {
    // As on a first visit: no current space, and no default one yet
    localStorage.removeItem('current-space-id')
    localStorage.removeItem('current-space-name')
    for (const space of await listSpaces()) {
      if (space.name === 'Personal') await deleteSpace(space.id)
    }
  })

  it('creates the default space once when called twice at the same time', async () => {
    const [first, second] = await Promise.all([ensureCurrentSpace(), ensureCurrentSpace()])
    expect(first.name).to.equal('Personal')
    expect(second.id).to.equal(first.id)
    const personal = (await listSpaces()).filter(space => space.name === 'Personal')
    expect(personal).to.have.length(1)
  })

  it('refuses a name already in use with a ConstraintError, not a bare null', async () => {
    const { name } = await ensureCurrentSpace()
    let error: Error | null = null
    try {
      await createSpace(name)
    } catch (caught) {
      error = caught as Error
    }
    expect(error?.name).to.equal('ConstraintError')
  })
})

describe('a device from before spaces were called spaces', () => {
  const LEGACY = [
    'current-organisation-id',
    'current-organisation-name',
    'current-organisation-read-only',
  ]

  afterEach(() => {
    for (const key of LEGACY) localStorage.removeItem(key)
    localStorage.removeItem('current-space-read-only')
  })

  it('has its current space moved to the new keys', () => {
    localStorage.setItem('current-organisation-id', 'old-id')
    localStorage.setItem('current-organisation-name', 'Old Church')
    localStorage.setItem('current-organisation-read-only', '1')
    migrateLegacyKeys()
    expect(getCurrentSpace()).to.deep.equal({ id: 'old-id', name: 'Old Church' })
    expect(localStorage.getItem('current-space-read-only')).to.equal('1')
    for (const key of LEGACY) expect(localStorage.getItem(key), key).to.equal(null)
  })

  it('keeps a value already under the new key', () => {
    localStorage.setItem('current-space-id', 'new-id')
    localStorage.setItem('current-organisation-id', 'old-id')
    migrateLegacyKeys()
    expect(getCurrentSpace().id).to.equal('new-id')
    expect(localStorage.getItem('current-organisation-id')).to.equal(null)
  })
})

describe('the current space', () => {
  const unique = name => `${name} ${crypto.randomUUID().slice(0, 8)}`

  it('is remembered with its name, fetched when not given', async () => {
    const space = await createSpace(unique('Church'))
    await setCurrentSpace(space.id, space.name)
    expect(getCurrentSpace()).to.deep.equal({ id: space.id, name: space.name })

    const other = await createSpace(unique('Other'))
    await setCurrentSpace(other.id)
    expect(getCurrentSpace()).to.deep.equal({ id: other.id, name: other.name })
  })

  it('is found by name', async () => {
    const space = await createSpace(unique('Named'))
    expect(must(await getSpaceByName(space.name)).id).to.equal(space.id)
    expect(await getSpaceByName(unique('Nobody'))).to.equal(undefined)
  })

  it('falls back to the default space when the remembered one is gone', async () => {
    localStorage.setItem('current-space-id', 'deleted-space')
    localStorage.setItem('current-space-name', 'Deleted')
    const space = await getCurrentSpaceFull()
    expect(space.name).to.equal('Personal')
    expect(getCurrentSpace()).to.deep.equal({ id: space.id, name: 'Personal' })
  })
})

describe('creating the default space beside another page', () => {
  const realByName = SpaceDB.prototype.getSpaceByName
  afterEach(() => {
    SpaceDB.prototype.getSpaceByName = realByName
  })

  it('reads back the one the other page made, when the name is taken', async () => {
    localStorage.removeItem('current-space-id')
    const { id } = await ensureCurrentSpace()
    localStorage.removeItem('current-space-id')
    // The first look finds nothing (the other page had not made it yet); making it is refused
    let looks = 0
    SpaceDB.prototype.getSpaceByName = function (name) {
      return looks++ === 0 ? Promise.resolve(undefined) : realByName.call(this, name)
    }
    expect((await ensureCurrentSpace()).id).to.equal(id)
  })

  it('gives up when the name is taken and then cannot be found', async () => {
    localStorage.removeItem('current-space-id')
    await ensureCurrentSpace()
    localStorage.removeItem('current-space-id')
    SpaceDB.prototype.getSpaceByName = () => Promise.resolve(undefined)
    let error: Error | null = null
    try {
      await ensureCurrentSpace()
    } catch (caught) {
      error = caught as Error
    }
    expect(error?.name).to.equal('ConstraintError')
  })

  it('passes on any other failure', async () => {
    localStorage.removeItem('current-space-id')
    const realCreate = SpaceDB.prototype.createSpace
    SpaceDB.prototype.getSpaceByName = () => Promise.resolve(undefined)
    SpaceDB.prototype.createSpace = () => Promise.reject(new Error('disk full'))
    try {
      let message = ''
      try {
        await ensureCurrentSpace()
      } catch (caught) {
        message = (caught as Error).message
      }
      expect(message).to.equal('disk full')
    } finally {
      SpaceDB.prototype.createSpace = realCreate
    }
  })
})

describe('keeping the current space when it cannot be read', () => {
  const realGet = SpaceDB.prototype.getSpace
  afterEach(() => {
    SpaceDB.prototype.getSpace = realGet
  })

  it('still remembers it', async () => {
    SpaceDB.prototype.getSpace = () => Promise.reject(new Error('unreadable'))
    await setCurrentSpace('some-id', 'Some name')
    expect(getCurrentSpace()).to.deep.equal({ id: 'some-id', name: 'Some name' })
  })
})

describe('switching space', () => {
  const unique = name => `${name} ${crypto.randomUUID().slice(0, 8)}`

  it('makes it the current one, with its name, and starts the app afresh', async () => {
    const space = await createSpace(unique('Switch'))
    let reloads = 0
    await switchSpace(space.id, () => reloads++)
    expect(getCurrentSpace()).to.deep.equal({ id: space.id, name: space.name })
    expect(reloads).to.equal(1)
  })

  it('switches to one it has no record of, too', async () => {
    let reloads = 0
    await switchSpace('unknown-id', () => reloads++)
    expect(getCurrentSpace().id).to.equal('unknown-id')
    expect(reloads).to.equal(1)
  })

  it('still switches when the space cannot be read', async () => {
    const realGet = SpaceDB.prototype.getSpace
    let calls = 0
    SpaceDB.prototype.getSpace = function (id) {
      return calls++ === 0 ? Promise.reject(new Error('unreadable')) : realGet.call(this, id)
    }
    try {
      let reloads = 0
      await switchSpace('another-id', () => reloads++)
      expect(getCurrentSpace().id).to.equal('another-id')
      expect(reloads).to.equal(1)
    } finally {
      SpaceDB.prototype.getSpace = realGet
    }
  })
})

describe('renaming a space', () => {
  const unique = name => `${name} ${crypto.randomUUID().slice(0, 8)}`

  it('keeps its id, and the remembered name if it is the current one', async () => {
    const space = await createSpace(unique('Before'))
    await setCurrentSpace(space.id, space.name)
    const after = unique('After')
    const renamed = await renameSpace(space.id, after)
    expect(renamed.id).to.equal(space.id)
    expect(renamed.name).to.equal(after)
    expect(getCurrentSpace().name).to.equal(after)
  })

  it('leaves the remembered name when it is not the current one', async () => {
    const current = await createSpace(unique('Current'))
    await setCurrentSpace(current.id, current.name)
    const other = await createSpace(unique('Other'))
    await renameSpace(other.id, unique('Renamed'))
    expect(getCurrentSpace().name).to.equal(current.name)
  })

  it('may be given its own name again', async () => {
    const space = await createSpace(unique('Same'))
    expect((await renameSpace(space.id, space.name)).name).to.equal(space.name)
  })

  it('refuses one that is not there, or a name already in use', async () => {
    const first = await createSpace(unique('First'))
    const second = await createSpace(unique('Second'))
    let message = ''
    try {
      await renameSpace('nobody', 'x')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).to.equal('Space nobody not found')
    try {
      await renameSpace(second.id, first.name)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).to.equal(`Space "${first.name}" already exists`)
  })
})

describe('deleting a space and its data', () => {
  it('refuses one that is not there', async () => {
    let message = ''
    try {
      await deleteSpaceAndData('nobody')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).to.equal('Space nobody not found')
  })
})

/** Delete a space record directly, to reset to a first visit */
function deleteSpace(id) {
  return new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('spaces')
    open.onsuccess = () => {
      const tx = open.result.transaction(['spaces'], 'readwrite')
      tx.objectStore('spaces').delete(id)
      tx.oncomplete = () => {
        open.result.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
  })
}
