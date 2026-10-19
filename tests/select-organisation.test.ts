import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import type { SelectOrganisation } from '../src/components/select-organisation.ts'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  setCurrentOrganisation,
} from '../src/js/organisation.ts'
import { OrganisationDB } from '../src/js/organisation-db.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/components/select-organisation.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('select-organisation', () => {
  let before: { id: string | null; name: string }
  let current: { id: string; name: string }
  let other: { id: string; name: string }
  const made: string[] = []
  const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`

  beforeEach(async () => {
    before = getCurrentOrganisation()
    current = await createOrganisation(unique('Current'))
    other = await createOrganisation(unique('Other'))
    made.push(current.id, other.id)
    await setCurrentOrganisation(current.id, current.name)
  })

  afterEach(async () => {
    while (made.length) await deleteOrganisation(made.pop() as string)
    if (before.id) await setCurrentOrganisation(before.id, before.name)
  })

  async function show() {
    const el = await fixture<SelectOrganisation>(html`<select-organisation></select-organisation>`)
    await waitUntil(() => el.shadowRoot?.querySelector('.organisation-item'), 'it lists them')
    return el
  }
  const items = (el: SelectOrganisation) =>
    [...(el.shadowRoot?.querySelectorAll('.organisation-item') ?? [])] as HTMLElement[]
  const itemFor = (el: SelectOrganisation, name: string) =>
    items(el).find(item => item.querySelector('.organisation-name')?.textContent === name)
  const modalOf = (el: SelectOrganisation) => el.shadowRoot?.querySelector('app-modal') as AppModal
  const text = (el: SelectOrganisation) => el.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''

  describe('the list', () => {
    it('shows the organisations, with the current one marked', async () => {
      const el = await show()
      expect(itemFor(el, current.name)?.classList.contains('current')).to.equal(true)
      expect(itemFor(el, current.name)?.textContent).to.contain('CURRENT')
      expect(itemFor(el, other.name)?.querySelector('.switch-button')).to.not.equal(null)
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

    it('does nothing for the organisation it is already in', async () => {
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
      el._switchModal = { value: undefined } as SelectOrganisation['_switchModal']
      await el._handleSwitch({ id: 'x', name: 'x' } as never)
      expect(asked).to.equal(0)
    })
  })

  describe('making a new one', () => {
    const open = async (el: SelectOrganisation) => {
      el.shadowRoot?.querySelector<HTMLButtonElement>('.btn.block')?.click()
      await el.updateComplete
    }
    const type = async (el: SelectOrganisation, value: string) => {
      const input = el.shadowRoot?.querySelector('input') as HTMLInputElement
      input.value = value
      input.dispatchEvent(new Event('input'))
      await el.updateComplete
    }
    const submit = async (el: SelectOrganisation) => {
      el.shadowRoot?.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 50))
      await el.updateComplete
    }

    it('shows a form, and hides it again on cancel', async () => {
      const el = await show()
      await open(el)
      expect(el.shadowRoot?.querySelector('form')).to.not.equal(null)
      el.shadowRoot
        ?.querySelector<HTMLButtonElement>('.create-form-buttons .btn:not(.primary)')
        ?.click()
      await el.updateComplete
      expect(el.shadowRoot?.querySelector('form')).to.equal(null)
    })

    it('asks for a name, and refuses one that is taken', async () => {
      const el = await show()
      await open(el)
      await type(el, '   ')
      await submit(el)
      expect(text(el)).to.contain('Please enter a space name')
      await type(el, other.name)
      await submit(el)
      expect(text(el)).to.contain('A space with this name already exists')
    })

    it('makes it, and lists it', async () => {
      const el = await show()
      await open(el)
      const name = unique('Brand new')
      await type(el, name)
      await submit(el)
      await waitUntil(() => itemFor(el, name), 'the new one is listed')
      made.push(
        (await (await import('../src/js/organisation.ts')).getOrganisationByName(name))
          ?.id as string
      )
      expect(el.shadowRoot?.querySelector('form')).to.equal(null)
    })

    it('says why it could not be made', async () => {
      const el = await show()
      await open(el)
      const realCreate = OrganisationDB.prototype.createOrganisation
      OrganisationDB.prototype.createOrganisation = () => Promise.reject(new Error('disk full'))
      try {
        await type(el, unique('Fails'))
        await submit(el)
      } finally {
        OrganisationDB.prototype.createOrganisation = realCreate
      }
      expect(text(el)).to.contain('Failed to create space: disk full')
      expect(el._creating).to.equal(false)
    })

    it('says a failure that is not an Error as it is', async () => {
      const el = await show()
      await open(el)
      const realCreate = OrganisationDB.prototype.createOrganisation
      OrganisationDB.prototype.createOrganisation = () => Promise.reject('plain text')
      try {
        await type(el, unique('Fails'))
        await submit(el)
      } finally {
        OrganisationDB.prototype.createOrganisation = realCreate
      }
      expect(text(el)).to.contain('Failed to create space: plain text')
    })
  })

  describe('when the list cannot be read', () => {
    it('says so', async () => {
      const realAll = OrganisationDB.prototype.getAllOrganisations
      OrganisationDB.prototype.getAllOrganisations = () => Promise.reject(new Error('no access'))
      try {
        const el = await fixture<SelectOrganisation>(
          html`<select-organisation></select-organisation>`
        )
        await waitUntil(() => text(el).includes("Couldn't load"), 'it says so')
        expect(text(el)).to.contain('no access')
      } finally {
        OrganisationDB.prototype.getAllOrganisations = realAll
      }
    })

    it('says a failure that is not an Error as it is', async () => {
      const realAll = OrganisationDB.prototype.getAllOrganisations
      OrganisationDB.prototype.getAllOrganisations = () => Promise.reject('plain text')
      try {
        const el = await fixture<SelectOrganisation>(
          html`<select-organisation></select-organisation>`
        )
        await waitUntil(() => text(el).includes("Couldn't load"), 'it says so')
        expect(text(el)).to.contain('plain text')
      } finally {
        OrganisationDB.prototype.getAllOrganisations = realAll
      }
    })

    it('says there are none, with none', async () => {
      const realAll = OrganisationDB.prototype.getAllOrganisations
      OrganisationDB.prototype.getAllOrganisations = () => Promise.resolve([])
      try {
        const el = await fixture<SelectOrganisation>(
          html`<select-organisation></select-organisation>`
        )
        await waitUntil(() => text(el).includes('No spaces found'), 'it says so')
      } finally {
        OrganisationDB.prototype.getAllOrganisations = realAll
      }
    })
  })
})
