import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import type { SelectSpace } from '../src/components/select-space.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  setCurrentSpace,
  updateSpace,
} from '../src/js/space.ts'
import { SpaceDB } from '../src/js/space-db.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/components/select-space.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('select-space', () => {
  let before: { id: string | null; name: string }
  let current: { id: string; name: string }
  let other: { id: string; name: string }
  const made: string[] = []
  const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`

  beforeEach(async () => {
    before = getCurrentSpace()
    current = await createSpace(unique('Current'))
    other = await createSpace(unique('Other'))
    made.push(current.id, other.id)
    await setCurrentSpace(current.id, current.name)
  })

  afterEach(async () => {
    while (made.length) await deleteSpace(made.pop() as string)
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  async function show() {
    const el = await fixture<SelectSpace>(html`<select-space></select-space>`)
    await waitUntil(() => el.shadowRoot?.querySelector('.space-item'), 'it lists them')
    return el
  }
  const items = (el: SelectSpace) =>
    [...(el.shadowRoot?.querySelectorAll('.space-item') ?? [])] as HTMLElement[]
  const itemFor = (el: SelectSpace, name: string) =>
    items(el).find(item => item.querySelector('.space-name')?.textContent === name)
  const modalOf = (el: SelectSpace) => el.shadowRoot?.querySelector('app-modal') as AppModal
  const text = (el: SelectSpace) => el.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''

  describe('the list', () => {
    it('shows the spaces, with the current one marked', async () => {
      const el = await show()
      expect(itemFor(el, current.name)?.classList.contains('current')).to.equal(true)
      expect(itemFor(el, current.name)?.textContent).to.contain('CURRENT')
      expect(itemFor(el, other.name)?.querySelector('.switch-button')).to.not.equal(null)
    })
  })

  describe('what kind of space it is', () => {
    const kindOfItem = (el: SelectSpace, name: string) =>
      itemFor(el, name)?.querySelector('.space-kind')?.textContent ?? null

    it('says a team space is one, and the role in it', async () => {
      const spaces = await Promise.all(
        (['owner', 'admin', 'writer', 'reader'] as const).map(async role => {
          const space = await createSpace(unique(`Team ${role}`))
          made.push(space.id)
          await updateSpace(space.id, { team: { id: `team-${role}`, role } })
          return { role, name: space.name }
        })
      )
      const el = await show()
      for (const { role, name } of spaces) {
        expect(kindOfItem(el, name)).to.equal(`Team · ${role}`)
      }
    })

    it('says a space the person can only view is, and nothing of a space of their own', async () => {
      const viewing = await createSpace(unique('Viewing'))
      made.push(viewing.id)
      await updateSpace(viewing.id, { readOnly: true })
      const el = await show()
      expect(kindOfItem(el, viewing.name)).to.equal('View only')
      expect(kindOfItem(el, current.name)).to.equal(null)
    })

    it('says how a team space is joined', async () => {
      const el = await show()
      expect(text(el)).to.contain('To join a team space, open the invite link its admin sent you.')
    })
  })

  describe('switching', () => {
    it('asks first, and switches when told to', async () => {
      const el = await show()
      const switched: string[] = []
      el.switchTo = async id => {
        switched.push(id)
      }
      let asked = ''
      modalOf(el).ask = async () => {
        asked = modalOf(el).message
        return true
      }
      itemFor(el, other.name)?.querySelector<HTMLButtonElement>('.switch-button')?.click()
      await waitUntil(() => switched.length, 'it switches')
      expect(switched).to.deep.equal([other.id])
      expect(asked).to.contain(other.name)
    })

    it('also switches from a click on the row, once only for a click on the button', async () => {
      const el = await show()
      const switched: string[] = []
      el.switchTo = async id => {
        switched.push(id)
      }
      modalOf(el).ask = async () => true
      itemFor(el, other.name)?.click()
      await waitUntil(() => switched.length, 'it switches')
      itemFor(el, other.name)?.querySelector<HTMLButtonElement>('.switch-button')?.click()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(switched).to.deep.equal([other.id, other.id])
    })

    it('stays when it is not confirmed', async () => {
      const el = await show()
      const switched: string[] = []
      el.switchTo = async id => {
        switched.push(id)
      }
      modalOf(el).ask = async () => false
      itemFor(el, other.name)?.click()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(switched).to.deep.equal([])
    })

    it('does nothing for the space it is already in', async () => {
      const el = await show()
      let asked = 0
      modalOf(el).ask = async () => {
        asked++
        return true
      }
      itemFor(el, current.name)?.click()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(asked).to.equal(0)
    })

    it('does nothing before it has its modal', async () => {
      const el = await show()
      let asked = 0
      modalOf(el).ask = async () => {
        asked++
        return true
      }
      el._switchModal = { value: undefined } as SelectSpace['_switchModal']
      await el._handleSwitch({ id: 'x', name: 'x' } as never)
      expect(asked).to.equal(0)
    })
  })

  it('has no way to make a space: that comes with a team', async () => {
    const el = await show()
    expect(el.shadowRoot?.querySelector('form')).to.equal(null)
    expect(el.shadowRoot?.querySelector('input')).to.equal(null)
    expect(text(el)).to.not.contain('Create')
  })

  describe('when the list cannot be read', () => {
    it('says so', async () => {
      const realAll = SpaceDB.prototype.getAllSpaces
      SpaceDB.prototype.getAllSpaces = () => Promise.reject(new Error('no access'))
      try {
        const el = await fixture<SelectSpace>(html`<select-space></select-space>`)
        await waitUntil(() => text(el).includes("Couldn't load"), 'it says so')
        expect(text(el)).to.contain('no access')
      } finally {
        SpaceDB.prototype.getAllSpaces = realAll
      }
    })

    it('says a failure that is not an Error as it is', async () => {
      const realAll = SpaceDB.prototype.getAllSpaces
      SpaceDB.prototype.getAllSpaces = () => Promise.reject('plain text')
      try {
        const el = await fixture<SelectSpace>(html`<select-space></select-space>`)
        await waitUntil(() => text(el).includes("Couldn't load"), 'it says so')
        expect(text(el)).to.contain('plain text')
      } finally {
        SpaceDB.prototype.getAllSpaces = realAll
      }
    })

    it('says there are none, with none', async () => {
      const realAll = SpaceDB.prototype.getAllSpaces
      SpaceDB.prototype.getAllSpaces = () => Promise.resolve([])
      try {
        const el = await fixture<SelectSpace>(html`<select-space></select-space>`)
        await waitUntil(() => text(el).includes('No spaces found'), 'it says so')
      } finally {
        SpaceDB.prototype.getAllSpaces = realAll
      }
    })
  })
})
