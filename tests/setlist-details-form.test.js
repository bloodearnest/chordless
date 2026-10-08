import { expect } from '@esm-bundle/chai'
import { leaderChoices } from '../public/components/setlist-details-form.js'

const { describe, it, afterEach } = window

const ann = { id: 'ann@example.com', name: 'Ann Smith' }
const ben = { id: 'ben@example.com', name: 'Ben Jones' }

describe('leaderChoices', () => {
  it('offers the people, with nothing selected for a setlist without a leader', () => {
    const { options, selected } = leaderChoices({}, [ann, ben])
    expect(options.map(o => o.person)).to.deep.equal([ann, ben])
    expect(selected).to.equal('')
  })

  it('selects the leader by id', () => {
    const { options, selected } = leaderChoices({ owner: 'Ann', ownerId: 'ANN@example.com' }, [
      ann,
      ben,
    ])
    expect(options.find(o => o.value === selected).person).to.equal(ann)
  })

  it('matches a leader recorded by name only to the person with that name', () => {
    const { options, selected } = leaderChoices({ owner: 'ben jones' }, [ann, ben])
    expect(options).to.have.length(2)
    expect(options.find(o => o.value === selected).person).to.equal(ben)
  })

  it('keeps a leader who is not one of the people as an extra choice', () => {
    const byName = leaderChoices({ owner: 'Visiting Leader' }, [ann])
    expect(byName.options).to.have.length(2)
    expect(byName.options.find(o => o.value === byName.selected).person).to.deep.equal({
      id: '',
      name: 'Visiting Leader',
    })

    const byId = leaderChoices({ owner: 'Cara', ownerId: 'cara@example.com' }, [ann])
    expect(byId.options.find(o => o.value === byId.selected).person).to.deep.equal({
      id: 'cara@example.com',
      name: 'Cara',
    })
  })
})

describe('setlist-details-form', () => {
  let form

  async function makeForm(setlist, people = [ann, ben]) {
    form = document.createElement('setlist-details-form')
    form.people = people
    form.setlist = setlist
    document.body.appendChild(form)
    await form.updateComplete
    return form
  }

  const field = id => form.shadowRoot.getElementById(id)

  function type(id, value) {
    field(id).value = value
    field(id).dispatchEvent(new Event('input'))
  }

  async function choose(id, value) {
    field(id).value = value
    field(id).dispatchEvent(new Event('change'))
    await form.updateComplete
  }

  /** The value of the leader option showing this name */
  const leaderValue = name => [...field('leader').options].find(o => o.text === name).value

  function nextEvent(name) {
    return new Promise(resolve => form.addEventListener(name, resolve, { once: true }))
  }

  async function save() {
    const saved = nextEvent('save')
    form.shadowRoot.querySelector('.submit').click()
    return (await saved).detail
  }

  afterEach(() => form?.remove())

  const setlist = {
    date: '2026-10-11',
    time: '18:30',
    type: 'Prayer Meeting',
    name: 'Harvest',
    owner: 'Ann Smith',
    ownerId: 'ann@example.com',
  }

  it("shows the setlist's details", async () => {
    await makeForm(setlist)
    expect(field('date').value).to.equal('2026-10-11')
    expect(field('time').value).to.equal('18:30')
    expect(field('type').value).to.equal('Prayer Meeting')
    expect(field('name').value).to.equal('Harvest')
    expect(field('leader').value).to.equal(leaderValue('Ann Smith'))
  })

  it('lists no leader, the people and Other… as leader choices', async () => {
    await makeForm(setlist)
    expect([...field('leader').options].map(o => o.text)).to.deep.equal([
      'No leader',
      'Ann Smith',
      'Ben Jones',
      'Other…',
    ])
  })

  it("saves the details, with the chosen leader's name and id", async () => {
    await makeForm(setlist)
    type('name', ' Harvest Festival ')
    field('type').value = 'Event'
    await choose('leader', leaderValue('Ben Jones'))

    expect(await save()).to.deep.equal({
      date: '2026-10-11',
      time: '18:30',
      type: 'Event',
      name: 'Harvest Festival',
      owner: 'Ben Jones',
      ownerId: 'ben@example.com',
    })
  })

  it('saves a leader typed in with Other… by name only', async () => {
    await makeForm(setlist)
    expect(field('leader-other')).to.equal(null)
    await choose('leader', 'other')
    type('leader-other', '  Visiting Leader  ')

    const detail = await save()
    expect(detail.owner).to.equal('Visiting Leader')
    expect(detail.ownerId).to.equal('')
  })

  it('saves no leader', async () => {
    await makeForm(setlist)
    await choose('leader', '')
    const detail = await save()
    expect(detail.owner).to.equal('')
    expect(detail.ownerId).to.equal('')
  })

  it('adds the id when saving a leader recorded by name only', async () => {
    await makeForm({ ...setlist, owner: 'Ann Smith', ownerId: undefined })
    const detail = await save()
    expect(detail.ownerId).to.equal('ann@example.com')
  })

  it('fires cancel', async () => {
    await makeForm(setlist)
    const cancelled = nextEvent('cancel')
    form.shadowRoot.querySelector('.cancel').click()
    await cancelled
  })

  it('discards changes when shown again with the same setlist', async () => {
    await makeForm(setlist)
    type('name', 'Typed but not saved')
    field('type').value = 'Other'
    await choose('leader', 'other')

    form.setlist = { ...setlist }
    await form.updateComplete

    expect(field('name').value).to.equal('Harvest')
    expect(field('type').value).to.equal('Prayer Meeting')
    expect(field('leader').value).to.equal(leaderValue('Ann Smith'))
    expect(field('leader-other')).to.equal(null)
  })

  it('keeps a type that is not in the standard list', async () => {
    await makeForm({ ...setlist, type: 'Youth Service' })
    expect(field('type').value).to.equal('Youth Service')
  })
})
