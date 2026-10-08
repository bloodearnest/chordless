import { expect } from '@esm-bundle/chai'
import '../public/components/setlist-details-form.js'

const { describe, it, afterEach } = window

describe('setlist-details-form', () => {
  let form

  async function makeForm(setlist) {
    form = document.createElement('setlist-details-form')
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

  function nextEvent(name) {
    return new Promise(resolve => form.addEventListener(name, resolve, { once: true }))
  }

  afterEach(() => form?.remove())

  const setlist = {
    date: '2026-10-11',
    time: '18:30',
    type: 'Prayer Meeting',
    name: 'Harvest',
    owner: 'Ann',
  }

  it("shows the setlist's details", async () => {
    await makeForm(setlist)
    expect(field('date').value).to.equal('2026-10-11')
    expect(field('time').value).to.equal('18:30')
    expect(field('type').value).to.equal('Prayer Meeting')
    expect(field('name').value).to.equal('Harvest')
    expect(field('leader').value).to.equal('Ann')
  })

  it('saves the details, with the leader trimmed and stored as owner', async () => {
    await makeForm(setlist)
    type('leader', '  Ben  ')
    type('name', ' Harvest Festival ')
    field('type').value = 'Event'
    type('time', '19:05')
    const saved = nextEvent('save')
    form.shadowRoot.querySelector('.submit').click()

    expect((await saved).detail).to.deep.equal({
      date: '2026-10-11',
      time: '19:05',
      type: 'Event',
      name: 'Harvest Festival',
      owner: 'Ben',
    })
  })

  it('fires cancel', async () => {
    await makeForm(setlist)
    const cancelled = nextEvent('cancel')
    form.shadowRoot.querySelector('.cancel').click()
    await cancelled
  })

  it('discards typed changes when shown again with the same setlist', async () => {
    await makeForm(setlist)
    type('leader', 'Typed but not saved')
    field('type').value = 'Other'
    type('time', '07:00')

    form.setlist = { ...setlist }
    await form.updateComplete

    expect(field('leader').value).to.equal('Ann')
    expect(field('type').value).to.equal('Prayer Meeting')
    expect(field('time').value).to.equal('18:30')
  })

  it('keeps a type that is not in the standard list', async () => {
    await makeForm({ ...setlist, type: 'Youth Service' })
    expect(field('type').value).to.equal('Youth Service')
  })
})
