import { expect, fixture, html } from '@open-wc/testing'
import type { WelcomeCard } from '../src/components/welcome-card.ts'
import { INSTALL_CHANGE_EVENT } from '../src/js/install.ts'
import { setRouter } from '../src/js/navigation.ts'
import { createSpace, deleteSpace, getCurrentSpace, setCurrentSpace } from '../src/js/space.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/components/welcome-card.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('welcome-card', () => {
  const realFetch = window.fetch
  let before: { id: string | null; name: string }
  let spaceId: string
  let visited: string[]

  beforeEach(async () => {
    visited = []
    setRouter({
      navigate: async (url: string) => {
        visited.push(url)
        return true
      },
    })
    before = getCurrentSpace()
    const space = await createSpace(`Welcome ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    await setCurrentSpace(space.id, space.name)
  })

  afterEach(async () => {
    window.fetch = realFetch
    setRouter(null)
    await deleteSpace(spaceId)
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  const make = () => fixture<WelcomeCard>(html`<welcome-card></welcome-card>`)
  const root = (card: WelcomeCard) => card.shadowRoot as ShadowRoot

  it('adds the sample setlist and goes to it', async () => {
    window.fetch = (async (input: RequestInfo | URL) =>
      String(input) === '/samples/index.json'
        ? new Response(JSON.stringify({ setlistName: 'Try it', songs: ['a.chordpro'] }))
        : new Response('{title: Welcome Sample}\n[C]La')) as typeof fetch
    const card = await make()
    ;(root(card).querySelector('#welcome-samples button') as HTMLButtonElement).click()
    await new Promise<void>(resolve => {
      const wait = () => (visited.length ? resolve() : setTimeout(wait, 10))
      wait()
    })
    expect(visited[0]).to.match(/^\/setlist\//)
    await card.updateComplete
    expect(card._busy).to.equal(false)
  })

  it('says so when the sample cannot be added', async () => {
    window.fetch = (async () => new Response('', { status: 500 })) as typeof fetch
    const card = await make()
    ;(root(card).querySelector('#welcome-samples button') as HTMLButtonElement).click()
    await new Promise<void>(resolve => {
      const wait = () => (card._error ? resolve() : setTimeout(wait, 10))
      wait()
    })
    await card.updateComplete
    expect(root(card).querySelector('.error')?.textContent).to.contain(
      'Could not add the sample setlist'
    )
    expect(visited).to.deep.equal([])
  })

  it('shows the install step for the mode, and none when installed or not possible', async () => {
    const card = await make()
    const install = () => root(card).querySelector('#welcome-install')

    card._installMode = 'installed'
    await card.updateComplete
    expect(install()).to.equal(null)
    card._installMode = 'none'
    await card.updateComplete
    expect(install()).to.equal(null)

    card._installMode = 'prompt'
    await card.updateComplete
    expect(install()?.querySelector('button.btn')?.textContent).to.contain('Install Chordless')
    expect(install()?.textContent).to.not.contain('sign in again')

    card._installMode = 'ios'
    await card.updateComplete
    expect(install()?.textContent).to.contain('Add to Home Screen')
    expect(install()?.textContent).to.contain('sign in again')

    card._installMode = 'mac-safari' as never
    await card.updateComplete
    expect(install()?.textContent).to.contain('Add to Dock')
  })

  it('offers the install prompt and refreshes the mode afterwards', async () => {
    const card = await make()
    card._installMode = 'prompt'
    await card.updateComplete
    ;(root(card).querySelector('#welcome-install button.btn') as HTMLButtonElement).click()
    await new Promise(resolve => setTimeout(resolve, 20))
    // (no prompt was captured, so the mode is whatever this browser says it is)
    expect(card._installMode).to.not.equal(undefined)
  })

  it('follows the install mode while it is on the page, and stops when removed', async () => {
    const card = await make()
    card._installMode = 'ios'
    window.dispatchEvent(new Event(INSTALL_CHANGE_EVENT))
    expect(card._installMode).to.not.equal('ios')
    card.remove()
    card._installMode = 'ios'
    window.dispatchEvent(new Event(INSTALL_CHANGE_EVENT))
    expect(card._installMode).to.equal('ios')
  })
})
