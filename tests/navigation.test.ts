import { expect } from '@open-wc/testing'
import { goTo, setPageTitle, setRouter } from '../src/js/navigation.ts'

const { describe, it, afterEach } = window

describe('navigation', () => {
  afterEach(() => setRouter(null))

  it('goes to a URL through the router, with the options', async () => {
    const asked: [string, object | undefined][] = []
    setRouter({
      navigate: async (url, options) => {
        asked.push([url, options])
        return true
      },
    })
    await goTo('/songs', { replace: true })
    expect(asked).to.deep.equal([['/songs', { replace: true }]])
  })

  it('gives the page a title through the router, if it can', () => {
    const titles: (string | null)[] = []
    setRouter({ navigate: async () => true, setTitle: title => titles.push(title) })
    setPageTitle('Sunday 25th October')
    setPageTitle(null)
    expect(titles).to.deep.equal(['Sunday 25th October', null])
  })

  it('does not mind a router that cannot set a title, or no router', () => {
    setRouter({ navigate: async () => true })
    expect(() => setPageTitle('x')).to.not.throw()
    setRouter(null)
    expect(() => setPageTitle('x')).to.not.throw()
  })
})
