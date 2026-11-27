import { expect, waitUntil } from '@open-wc/testing'
import type { ChurchConsole } from '../src/components/church-console.ts'
import '../src/components/church-console.ts'
import type { ChurchInfo, ChurchMember, ChurchTeam } from '../src/js/church-client.ts'
import { must } from './must.ts'

const { describe, it, afterEach } = window
const elements: ChurchConsole[] = []
afterEach(() => {
  for (const element of elements.splice(0)) element.remove()
})

function setup() {
  const churches: ChurchInfo[] = []
  const teams: ChurchTeam[] = []
  const members: ChurchMember[] = []
  const element = document.createElement('church-console')
  elements.push(element)
  element.authenticated = async () => true
  element.api = {
    ...element.api,
    list: async () => [...churches],
    teams: async () => [...teams],
    members: async () => [...members],
    create: async details => {
      churches.push({ ...details, id: 'church', role: 'admin' })
      teams.push({ id: 'team', name: details.name, archivedAt: null, followed: 1 })
      members.push({ id: 'admin', name: 'Pat', role: 'admin', joinedAt: '2026-11-22' })
      return { id: 'church' }
    },
    addTeam: async (_id, name) => {
      teams.push({ id: 'other', name, archivedAt: null, followed: 0 })
      return { id: 'other' }
    },
    invite: async () => ({ code: 'secret', expiresAt: '2026-12-01' }),
  }
  document.body.append(element)
  return { element, churches, teams, members }
}

async function ready(element: ChurchConsole) {
  await waitUntil(() => !element._loading, 'churches to load')
  await element.updateComplete
}
function setInput(form: HTMLFormElement, name: string, value: string) {
  const input = must(form.querySelector<HTMLInputElement>(`[name="${name}"]`))
  input.value = value
}
function submit(form: HTMLFormElement) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

describe('moving a team on Google Drive into the church', () => {
  it('offers an admin the teams they own or administer on Drive, and moves one after asking', async () => {
    const { element, churches, teams, members } = setup()
    churches.push({
      id: 'church',
      name: 'St Mary',
      country: 'GB',
      city: 'York',
      postcode: null,
      ccliLicence: null,
      licences: {},
      role: 'admin',
    })
    teams.push({ id: 'team', name: 'Own team', archivedAt: null, followed: 1 })
    members.push({ id: 'admin', name: 'Pat', role: 'admin', joinedAt: '2026-11-22' })
    const moved: [string, string][] = []
    element.driveTeams = async () => [
      { spaceId: 'drive-a', name: 'Morning', role: 'owner' },
      { spaceId: 'drive-b', name: 'Evening', role: 'writer' },
      { spaceId: 'drive-c', name: 'Band', role: 'admin' },
    ]
    element.api = {
      ...element.api,
      adopt: async (church, team) => {
        moved.push([church, team])
        return { teamId: team, churchId: church }
      },
    }
    await ready(element)
    const panel = must(element.shadowRoot?.querySelector('#drive-teams'))
    expect([...panel.querySelectorAll('.row span')].map(each => each.textContent)).to.deep.equal([
      'Morning',
      'Band',
    ])
    // declined: nothing moves
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button')]
    buttons[0].click()
    const modal = must(element._confirm.value)
    await waitUntil(() => modal.open, 'the question')
    must(modal.shadowRoot?.querySelector<HTMLElement>('.modal-btn-cancel')).click()
    await element.updateComplete
    expect(moved).to.deep.equal([])
    // confirmed: the church adopts it
    buttons[1].click()
    await waitUntil(() => modal.open, 'the question again')
    expect(modal.message).to.contain('Band').and.to.contain('St Mary')
    must(modal.shadowRoot?.querySelector<HTMLElement>('.modal-btn-confirm')).click()
    await waitUntil(() => moved.length === 1, 'the move')
    expect(moved).to.deep.equal([['church', 'drive-c']])
  })

  it('shows nothing for a member who is not an admin, or when the Worker cannot say which teams are on Drive', async () => {
    const { element, churches, teams, members } = setup()
    churches.push({
      id: 'church',
      name: 'St Mary',
      country: 'GB',
      city: 'York',
      postcode: null,
      ccliLicence: null,
      licences: {},
      role: 'writer',
    })
    teams.push({ id: 'team', name: 'Own team', archivedAt: null, followed: 1 })
    members.push({ id: 'me', name: 'Pat', role: 'writer', joinedAt: '2026-11-22' })
    element.driveTeams = async () => [{ spaceId: 'drive-a', name: 'Morning', role: 'owner' }]
    await ready(element)
    expect(element.shadowRoot?.querySelector('#drive-teams')).to.equal(null)
    const second = setup()
    second.churches.push({
      id: 'church',
      name: 'St Mary',
      country: 'GB',
      city: 'York',
      postcode: null,
      ccliLicence: null,
      licences: {},
      role: 'admin',
    })
    second.teams.push({ id: 'team', name: 'Own team', archivedAt: null, followed: 1 })
    second.members.push({ id: 'me', name: 'Pat', role: 'admin', joinedAt: '2026-11-22' })
    second.element.driveTeams = async () => {
      throw new Error('offline')
    }
    await ready(second.element)
    expect(second.element.shadowRoot?.querySelector('#drive-teams')).to.equal(null)
  })
})

describe('church administration', () => {
  it('creates a church, shows its first team and invites someone to it', async () => {
    const { element, churches, teams } = setup()
    await ready(element)
    const creation = must(element.shadowRoot?.querySelector<HTMLFormElement>('details form'))
    setInput(creation, 'name', 'St Mary')
    setInput(creation, 'country', 'GB')
    setInput(creation, 'city', 'York')
    submit(creation)
    await waitUntil(
      () => churches.length === 1 && element._teams.length === 1,
      'church to be created'
    )
    await element.updateComplete
    expect(element.shadowRoot?.textContent).to.contain('St Mary')
    expect(element.shadowRoot?.textContent).to.contain('Add your CCLI licence number')
    const form = must(
      element.shadowRoot?.querySelector<HTMLFormElement>('form:has(input[name="team"])')
    )
    setInput(form, 'team', 'Evening')
    submit(form)
    await waitUntil(() => teams.length === 2 && !element._busy, 'team to be created')
    await element.updateComplete
    const invite = must(
      element.shadowRoot?.querySelector<HTMLFormElement>('form:has(input[name="email"])')
    )
    setInput(invite, 'email', 'sam@example.com')
    submit(invite)
    await waitUntil(() => element._invite !== '', 'invitation to be made')
    expect(new URLSearchParams(new URL(element._invite).hash.slice(1)).get('code')).to.equal(
      'secret'
    )
  })

  it('keeps a reader able to follow teams without exposing administration controls', async () => {
    const { element, churches, teams } = setup()
    churches.push({
      id: 'c',
      name: 'Church',
      country: 'GB',
      city: 'York',
      postcode: null,
      ccliLicence: null,
      licences: {},
      role: 'reader',
    })
    teams.push({ id: 't', name: 'Morning', archivedAt: null, followed: 0 })
    let followed = false
    element.api = {
      ...element.api,
      follow: async (_church, _team, value) => {
        followed = value
      },
    }
    await ready(element)
    expect(element.shadowRoot?.textContent).not.to.contain('Add team')
    const checkbox = must(
      element.shadowRoot?.querySelector<HTMLInputElement>('input[type="checkbox"]')
    )
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))
    await waitUntil(() => followed, 'team to be followed')
  })

  it('manages church settings, roles, teams and an invitation', async () => {
    const { element, churches, teams, members } = setup()
    churches.push({
      id: 'c',
      name: 'Church',
      country: 'GB',
      city: 'York',
      postcode: null,
      ccliLicence: '123',
      licences: {},
      role: 'admin',
    })
    teams.push({ id: 't', name: 'Morning', archivedAt: null, followed: 1 })
    members.push({ id: 'a', name: 'Pat', role: 'admin', joinedAt: '2026-11-22' })
    const actions: string[] = []
    element.api = {
      ...element.api,
      update: async () => {
        actions.push('save')
        return { id: 'c' }
      },
      archiveTeam: async () => {
        actions.push('archive')
      },
      restoreTeam: async () => {
        actions.push('restore')
      },
      removeMember: async () => {
        actions.push('remove')
      },
      setRole: async () => {
        actions.push('role')
      },
    }
    element.confirm = async () => true
    element.copyText = async () => {
      actions.push('copy')
    }
    await ready(element)
    const church = churches[0]
    const team = teams[0]
    const member = members[0]
    const settings = must(element.shadowRoot?.querySelector<HTMLFormElement>('section form'))
    element.save({ preventDefault() {}, currentTarget: settings } as unknown as Event, church)
    await waitUntil(() => !element._busy && actions.includes('save'))
    await element.archive(church, team)
    await element.removeMember(church, member)
    const select = document.createElement('select')
    select.innerHTML = '<option value="admin">Admin</option><option value="reader">Reader</option>'
    select.value = 'reader'
    await element.changeRole(church, member, { currentTarget: select } as unknown as Event)
    element._invite = 'https://example.com'
    await element.copyInvite()
    expect(actions).to.deep.equal(['save', 'archive', 'remove', 'role', 'copy'])
  })

  it('accepts an invitation from the browser fragment', async () => {
    const { element } = setup()
    element.api = { ...element.api, join: async () => ({ churchId: 'c', teamId: 't' }) }
    history.replaceState(history.state, '', '#team=t&code=secret')
    try {
      await ready(element)
      element.join()
      await waitUntil(() => element._joined)
      expect(new URL(location.href).hash).to.equal('')
    } finally {
      history.replaceState(history.state, '', location.pathname)
    }
  })

  it('warns about a matching licence and lets the person cancel', async () => {
    const { element, churches } = setup()
    element.api = {
      ...element.api,
      matches: async () => [{ name: 'St Mary', city: 'York', country: 'GB' }],
    }
    let message = ''
    element.confirm = async text => {
      message = text
      return false
    }
    await ready(element)
    const form = must(element.shadowRoot?.querySelector<HTMLFormElement>('details form'))
    setInput(form, 'name', 'Church')
    setInput(form, 'country', 'GB')
    setInput(form, 'city', 'York')
    setInput(form, 'ccliLicence', '123')
    submit(form)
    await waitUntil(() => message !== '' && !element._busy)
    expect(message).to.contain('St Mary (York, GB)')
    expect(churches).to.have.length(0)
  })

  it('handles failures and cancelled changes without leaving the console busy', async () => {
    const { element, churches, teams, members } = setup()
    churches.push({
      id: 'c',
      name: 'Church',
      country: 'GB',
      city: 'York',
      postcode: null,
      ccliLicence: null,
      licences: {},
      role: 'admin',
    })
    teams.push({ id: 't', name: 'Team', archivedAt: null, followed: 1 })
    members.push({ id: 'a', name: null, role: 'admin', joinedAt: '2026-11-22' })
    await ready(element)
    element._busy = true
    let called = false
    await element.run(async () => {
      called = true
    })
    expect(called).to.equal(false)
    element._busy = false
    element.confirm = async () => false
    await element.archive(churches[0], teams[0])
    await element.removeMember(churches[0], members[0])
    const select = document.createElement('select')
    select.innerHTML = '<option value="admin">Admin</option><option value="reader">Reader</option>'
    select.value = 'reader'
    await element.changeRole(churches[0], members[0], { currentTarget: select } as unknown as Event)
    expect(select.value).to.equal('admin')
    await element.run(async () => {
      throw new Error('offline')
    })
    element.copyText = async () => {
      throw new Error('clipboard unavailable')
    }
    await element.copyInvite()
    expect(element._busy).to.equal(false)
  })

  it('uses the confirmation dialog and shows a sign-in prompt', async () => {
    const { element } = setup()
    await ready(element)
    const modal = must(element._confirm.value)
    modal.ask = async () => true
    expect(await element.confirm('Continue?')).to.equal(true)
    expect(modal.message).to.equal('Continue?')
    element.authenticated = async () => false
    await element.load()
    await element.updateComplete
    expect(element.shadowRoot?.textContent).to.contain('Sign in')
    element.authenticated = async () => {
      throw new Error('offline')
    }
    await element.load()
    expect(element._loading).to.equal(false)
  })

  it('handles empty form fields and switching between churches', async () => {
    const { element, churches } = setup()
    const church = {
      name: 'Church',
      country: 'GB',
      city: 'York',
      postcode: null,
      ccliLicence: null,
      licences: {},
      role: 'reader' as const,
    }
    churches.push({ ...church, id: 'a' }, { ...church, id: 'b' })
    await ready(element)
    const form = document.createElement('form')
    expect(element.details(form).name).to.equal('')
    element.addTeam({ preventDefault() {}, currentTarget: form } as unknown as Event, churches[0])
    await waitUntil(() => !element._busy)
    element.invite({ preventDefault() {}, currentTarget: form } as unknown as Event, churches[0])
    await waitUntil(() => !element._busy)
    element.join()
    const selector = must(element.shadowRoot?.querySelector<HTMLSelectElement>('select'))
    selector.value = 'b'
    selector.dispatchEvent(new Event('change'))
    expect(element._selected).to.equal('b')
    const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => {} },
    })
    try {
      await element.copyText('invitation')
    } finally {
      if (previous) Object.defineProperty(navigator, 'clipboard', previous)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})
