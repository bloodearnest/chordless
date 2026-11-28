import { expect, fixture, html } from '@open-wc/testing'
import { churchJoinUrl, type JoinView } from '../src/js/views/join-view.ts'
import '../src/js/views/join-view.ts'

const { describe, it } = window

describe('join-view', () => {
  it("sends an invite link to the church's page, with the invite in its fragment", () => {
    expect(churchJoinUrl({ name: 'join', teamId: 'team-1', code: 'abc' }, '')).to.equal(
      '/account/churches#team=team-1&code=abc'
    )
  })

  it('reads an older link, whose invite is its fragment', () => {
    const code = 'c'.repeat(20)
    expect(churchJoinUrl({ name: 'join' }, `#team-0001.${code}`)).to.equal(
      `/account/churches#team=team-0001&code=${code}`
    )
  })

  it("is the church's page as it is for a link with no invite in it", () => {
    expect(churchJoinUrl({ name: 'join' }, '')).to.equal('/account/churches')
    expect(churchJoinUrl({ name: 'join' }, '#not-an-invite')).to.equal('/account/churches')
    expect(churchJoinUrl(undefined, '')).to.equal('/account/churches')
  })

  it('goes there as soon as it is shown', async () => {
    const went: string[] = []
    const view = document.createElement('join-view') as JoinView
    view.go = url => void went.push(url)
    view.route = { name: 'join', teamId: 't', code: 'k' }
    await fixture<JoinView>(html`${view}`)
    expect(went).to.deep.equal(['/account/churches#team=t&code=k'])
  })
})
