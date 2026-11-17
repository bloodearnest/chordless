/**
 * Where the link in the sign-in email lands (sign-in-page.ts): it signs in with the address and code in the
 * link, goes on to the page the person was on, and says so when the link does not work.
 */
import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import '../src/components/sign-in-page.ts'
import { readSignInLink, type SignInPage } from '../src/components/sign-in-page.ts'
import { EmailCodeError } from '../src/js/google-auth.ts'
import { offerLink } from '../src/js/incoming-link.ts'
import { must } from './must.ts'

const { describe, it, afterEach } = window

const link = (params: Record<string, string>) => `#${new URLSearchParams(params)}`

describe('readSignInLink', () => {
  it('reads the address, the code and where to go on to', () => {
    expect(
      readSignInLink(link({ a: 'bea@example.com', c: '123456', n: '/join/x/y' }))
    ).to.deep.equal({
      address: 'bea@example.com',
      code: '123456',
      next: '/join/x/y',
    })
  })

  it('goes on to the home page unless the link names a page of this app', () => {
    for (const next of ['', 'https://evil.example/', '//evil.example', '/\\evil', 'join']) {
      expect(readSignInLink(link({ a: 'a@b.co', c: '1', n: next }))?.next, next).to.equal('/')
    }
    expect(readSignInLink(link({ a: 'a@b.co', c: '1' }))?.next).to.equal('/')
  })

  it('is nothing for a fragment without both', () => {
    for (const fragment of ['', '#', '#a=x%40y.co', '#c=123456', '#nonsense']) {
      expect(readSignInLink(fragment), fragment).to.equal(null)
    }
  })
})

describe('sign-in-page', () => {
  const realUrl = window.location.href
  afterEach(() => history.replaceState(null, '', realUrl))

  async function open(fragment: string, verify?: SignInPage['verify']) {
    const went: string[] = []
    const page = document.createElement('sign-in-page') as SignInPage
    page.fragment = fragment
    page.go = url => void went.push(url)
    if (verify) page.verify = verify
    document.body.append(page)
    await page.updateComplete
    const text = () => page.shadowRoot?.textContent ?? ''
    return { page, went, text }
  }

  it('signs in with the link, takes the code out of the address bar, and goes on', async () => {
    history.replaceState(null, '', `${window.location.pathname}${link({ c: 'secret' })}`)
    const used: string[] = []
    const { page, went } = await open(
      link({ a: 'bea@example.com', c: '123456', n: '/join/space-aaaa1111/abcdefghijklmnopqrstuv' }),
      async (address, code) => void used.push(`${address} ${code}`)
    )
    await waitUntil(() => went.length === 1, 'to go on')
    expect(used).to.deep.equal(['bea@example.com 123456'])
    expect(went).to.deep.equal(['/join/space-aaaa1111/abcdefghijklmnopqrstuv'])
    expect(window.location.hash).to.equal('')
    page.remove()
  })

  it('says the link has run out, and offers a new one for the same address', async () => {
    const { page, text } = await open(link({ a: 'bea@example.com', c: '1' }), async () => {
      throw new EmailCodeError('expired', 'x')
    })
    await waitUntil(() => text().includes('used or has run out'), 'the message')
    const form = must(page.shadowRoot?.querySelector('email-code-sign-in'))
    expect(form.address).to.equal('bea@example.com')
    page.remove()
  })

  it('goes on after a code typed into the form, to the page the link was for', async () => {
    const { page, went, text } = await open(
      link({ a: 'bea@example.com', c: '1', n: '/songs' }),
      async () => {
        throw new Error('no')
      }
    )
    await waitUntil(() => text().includes('used or has run out'), 'the message')
    must(page.shadowRoot?.querySelector('email-code-sign-in')).dispatchEvent(
      new Event('email-code:signed-in', { bubbles: true, composed: true })
    )
    expect(went).to.deep.equal(['/songs'])
    page.remove()
  })

  it('is the form to ask for a link, when there is none', async () => {
    const { page, text } = await open('')
    expect(text()).to.contain('enter your email address')
    const form = must(page.shadowRoot?.querySelector('email-code-sign-in'))
    expect(form.shadowRoot?.querySelector('input[name=address]')).to.exist
    page.remove()
  })

  it('uses a link the installed app was launched with, even while it is open', async () => {
    const used: string[] = []
    const { page, went } = await open(
      '',
      async (address, code) => void used.push(`${address} ${code}`)
    )
    offerLink('/sign-in', link({ a: 'cat@example.com', c: '654321' }))
    await waitUntil(() => went.length === 1, 'to go on')
    expect(used).to.deep.equal(['cat@example.com 654321'])
    page.remove()
  })

  it('stands in a fixture too', async () => {
    const page = await fixture<SignInPage>(html`<sign-in-page></sign-in-page>`)
    expect(page.shadowRoot?.querySelector('email-code-sign-in')).to.exist
  })
})
