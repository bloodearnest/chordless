/**
 * Where the link in the sign-in email lands (sign-in-page.ts): it signs in at once, except on iOS, where it asks
 * whether this browser or the installed app is the one to sign in (they keep separate sign-ins), and does not use
 * the link up until told to.
 */
import { expect, waitUntil } from '@open-wc/testing'
import '../src/components/sign-in-page.ts'
import type { SignInPage } from '../src/components/sign-in-page.ts'
import { EmailCodeError } from '../src/js/google-auth.ts'
import type { JoinOs } from '../src/js/join-device.ts'
import { must } from './must.ts'

const { describe, it, afterEach } = window

describe('sign-in-page', () => {
  const made: SignInPage[] = []
  afterEach(() => {
    for (const page of made.splice(0)) page.remove()
  })

  async function open(
    linkId: string | undefined,
    {
      os = 'other',
      standalone = false,
      signIn = async () => '/songs',
    }: { os?: JoinOs; standalone?: boolean; signIn?: SignInPage['signIn'] } = {}
  ) {
    const went: string[] = []
    const copied: string[] = []
    const peeked: string[] = []
    const page = document.createElement('sign-in-page') as SignInPage
    page.route = linkId ? { name: 'sign-in', linkId } : { name: 'sign-in' }
    page.device = { os, inAppBrowser: null }
    page.standalone = standalone
    page.signIn = signIn
    page.peek = async id => {
      peeked.push(id)
      return { address: 'bea@example.com', code: '123456', next: '/join/x/y' }
    }
    page.go = url => void went.push(url)
    page.copyText = async text => void copied.push(text)
    made.push(page)
    document.body.append(page)
    await page.updateComplete
    const text = () => page.shadowRoot?.textContent ?? ''
    const button = (label: string) =>
      must(
        [...(page.shadowRoot?.querySelectorAll('button') ?? [])].find(each =>
          each.textContent?.includes(label)
        )
      )
    return { page, went, copied, peeked, text, button }
  }

  it('signs in at once with the link, and goes on to the page it was asked from', async () => {
    const used: string[] = []
    const { went } = await open('abcdefghijklmnopqrstuv', {
      signIn: async id => {
        used.push(id)
        return '/join/space-aaaa1111/abcdefghijklmnopqrstuv'
      },
    })
    await waitUntil(() => went.length === 1, 'to go on')
    expect(used).to.deep.equal(['abcdefghijklmnopqrstuv'])
    expect(went).to.deep.equal(['/join/space-aaaa1111/abcdefghijklmnopqrstuv'])
  })

  it('says the link has been used or has run out, and offers the form for a new one', async () => {
    const { page, text } = await open('abcdefghijklmnopqrstuv', {
      signIn: async () => {
        throw new EmailCodeError('expired', 'x')
      },
    })
    await waitUntil(() => text().includes('has been used or has run out'), 'the message')
    expect(page.shadowRoot?.querySelector('email-code-sign-in')).to.exist
  })

  it('is the form to ask for a link when there is none, and goes home once signed in', async () => {
    const { page, went, text } = await open(undefined)
    expect(text()).to.contain('enter your email address')
    page.shadowRoot
      ?.querySelector('email-code-sign-in')
      ?.dispatchEvent(new Event('email-code:signed-in', { bubbles: true, composed: true }))
    expect(went).to.deep.equal(['/'])
  })

  describe('on an iPhone or iPad', () => {
    it('asks which to sign in, and uses nothing up until told', async () => {
      const used: string[] = []
      const { text, button, went } = await open('abcdefghijklmnopqrstuv', {
        os: 'ios',
        signIn: async id => {
          used.push(id)
          return '/songs'
        },
      })
      expect(text()).to.contain('installed app')
      expect(used).to.deep.equal([])
      button('Sign in in this browser').click()
      await waitUntil(() => went.length === 1, 'to go on')
      expect(used).to.deep.equal(['abcdefghijklmnopqrstuv'])
    })

    it('shows the code, copied, for the app, without using the link', async () => {
      const used: string[] = []
      const { text, button, copied, peeked, went } = await open('abcdefghijklmnopqrstuv', {
        os: 'ios',
        signIn: async id => {
          used.push(id)
          return '/songs'
        },
      })
      button('installed app').click()
      await waitUntil(() => text().includes('123456'), 'the code')
      expect(peeked).to.deep.equal(['abcdefghijklmnopqrstuv'])
      expect(copied).to.deep.equal(['123456'])
      expect(text()).to.contain('bea@example.com')
      expect(text()).to.contain('The code is copied')
      expect(text()).to.contain('I already have a code')
      expect(used).to.deep.equal([])
      expect(went).to.deep.equal([])
    })

    it('says to copy by hand where the clipboard is not allowed', async () => {
      const { page, text, button } = await open('abcdefghijklmnopqrstuv', { os: 'ios' })
      page.copyText = async () => {
        throw new Error('not allowed')
      }
      button('installed app').click()
      await waitUntil(() => text().includes('123456'), 'the code')
      expect(text()).to.contain('Copy the code by hand')
    })

    it('says so when the link has run out before the code was asked for', async () => {
      const { page, text, button } = await open('abcdefghijklmnopqrstuv', { os: 'ios' })
      page.peek = async () => {
        throw new EmailCodeError('expired', 'x')
      }
      button('installed app').click()
      await waitUntil(() => text().includes('has been used or has run out'), 'the message')
    })

    it('signs in at once when this is the installed app itself', async () => {
      const { went } = await open('abcdefghijklmnopqrstuv', { os: 'ios', standalone: true })
      await waitUntil(() => went.length === 1, 'to go on')
    })
  })
})
