import { expect } from '@open-wc/testing'
import {
  leaderChoices,
  SetlistDetailsCancelEvent,
  SetlistDetailsIdentifyEvent,
  SetlistDetailsSaveEvent,
} from '../src/components/setlist-details-form.ts'
import type { Person } from '../src/js/data-types.ts'
import { NEW_PERSON } from '../src/js/leaders.ts'
import { must } from './must.ts'
import { A11Y } from './test-helpers.ts'

const { describe, it, afterEach } = window

const NOW = '2026-10-29T10:00:00.000Z'
const ann: Person = {
  id: 'ann-id',
  name: 'Ann Smith',
  emails: ['ann@example.com'],
  modifiedDate: NOW,
}
const ben: Person = { id: 'ben-id', name: 'Ben Jones', emails: [], modifiedDate: NOW }

describe('leaderChoices', () => {
  it('offers the people, with nothing selected for a setlist without a leader', () => {
    const { options, selected } = leaderChoices({}, [ann, ben])
    expect(options.map(o => o.person)).to.deep.equal([ann, ben])
    expect(selected).to.equal('')
  })

  it('selects the leader by id', () => {
    const { options, selected } = leaderChoices({ leaderId: 'ann-id' }, [ann, ben])
    expect(must(options.find(o => o.value === selected)).person).to.equal(ann)
  })

  it('selects the person a merged leader was merged into', () => {
    const merged: Person = { ...ben, id: 'old-ben', mergedInto: 'ben-id' }
    const { options, selected } = leaderChoices({ leaderId: 'old-ben' }, [ann, ben, merged])
    expect(must(options.find(o => o.value === selected)).person).to.equal(ben)
  })

  it('selects nobody for a leader who is not one of the people (not synced here yet)', () => {
    const { options, selected } = leaderChoices({ leaderId: 'cara-id' }, [ann])
    expect(options).to.have.length(1)
    expect(selected).to.equal('')
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

  function nextEvent<E extends Event = Event>(name: string) {
    return new Promise<E>(resolve => form.addEventListener(name, resolve, { once: true }))
  }

  async function save() {
    const saved = nextEvent<SetlistDetailsSaveEvent>(SetlistDetailsSaveEvent.type)
    form.shadowRoot.querySelector('.submit').click()
    return (await saved).details
  }

  afterEach(() => form?.remove())

  it('can leave out its buttons, and be saved from outside with submit()', async () => {
    await makeForm({ date: '2026-10-18', name: 'Sunday' })
    form.hideActions = true
    await form.updateComplete
    expect(form.shadowRoot.querySelector('.submit')).to.equal(null)
    const saved = nextEvent<SetlistDetailsSaveEvent>(SetlistDetailsSaveEvent.type)
    form.submit()
    expect((await saved).details.name).to.equal('Sunday')
  })

  const setlist = {
    date: '2026-10-11',
    time: '18:30',
    type: 'Prayer Meeting',
    name: 'Harvest',
    leaderId: 'ann-id',
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
      leaderId: 'ben-id',
    })
  })

  it('saves a leader typed in with Other… as a name to find or make a person for', async () => {
    await makeForm(setlist)
    expect(field('leader-other')).to.equal(null)
    await choose('leader', 'other')
    type('leader-other', '  Visiting Leader  ')

    const detail = await save()
    expect(detail.newLeader).to.equal('Visiting Leader')
    expect(detail.leaderId).to.equal('')
  })

  it('guesses the type from the date and name as they change, for a new setlist', async () => {
    await makeForm({ date: '', name: '' })
    form.autoType = true
    await form.updateComplete

    await choose('date', '2026-10-18')
    expect(field('type').value, 'a Sunday').to.equal('Church Service')
    await choose('date', '2026-10-14')
    expect(field('type').value, 'a Wednesday').to.equal('Prayer Meeting')
    type('name', 'Harvest')
    await choose('date', '2026-10-14')
    expect(field('type').value, 'a named one').to.equal('Event')
  })

  it('leaves the type as chosen when it is not guessing, or the date is cleared', async () => {
    await makeForm({ date: '2026-10-18', type: 'Prayer Meeting' })
    await choose('date', '2026-10-14')
    expect(field('type').value).to.equal('Prayer Meeting')

    form.autoType = true
    await form.updateComplete
    await choose('date', '')
    expect(field('type').value).to.equal('Prayer Meeting')
  })

  it('saves no leader', async () => {
    await makeForm(setlist)
    await choose('leader', '')
    const detail = await save()
    expect(detail.leaderId).to.equal('')
    expect(detail.newLeader).to.equal(undefined)
  })

  it('marks the person using the app in the menu', async () => {
    await makeForm(setlist)
    form.meId = 'ben-id'
    await form.updateComplete
    expect([...field('leader').options].map(o => o.text)).to.include.members([
      'Ann Smith',
      'Ben Jones (you)',
    ])
  })

  it('asks which of the people is the one using the app only when it does not know', async () => {
    await makeForm(setlist)
    expect(field('who')).to.equal(null)
    form.askWho = true
    await form.updateComplete
    expect([...field('who').options].map(o => o.text)).to.deep.equal([
      'Not sure yet',
      'Ann Smith',
      'Ben Jones',
      'None of these: add me',
    ])
  })

  it('says which is the answer, not for “not sure”, and does not save it as a field', async () => {
    await makeForm(setlist)
    form.askWho = true
    await form.updateComplete
    const answers: string[] = []
    form.addEventListener(SetlistDetailsIdentifyEvent.type, e => answers.push(e.personId))
    await choose('who', '')
    await choose('who', 'ben-id')
    await choose('who', NEW_PERSON)
    expect(answers).to.deep.equal(['ben-id', NEW_PERSON])
    expect(Object.keys(await save())).to.not.include('who')
  })

  it('fires cancel', async () => {
    await makeForm(setlist)
    const cancelled = nextEvent(SetlistDetailsCancelEvent.type)
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

  it('is accessible', async () => {
    await makeForm(setlist)
    await expect(form).to.be.accessible(A11Y)
  })
})
