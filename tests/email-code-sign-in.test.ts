/**
 * Signing in with an emailed code (email-code-sign-in.ts): the address, then the code. Asking for the code and
 * checking it are the component's own functions here, so that what it shows can be seen without a Worker.
 */
import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import '../src/components/email-code-sign-in.ts'
import { type EmailCodeSignIn, SignedInEvent } from '../src/components/email-code-sign-in.ts'
import { EmailCodeError } from '../src/js/google-auth.ts'
import { must } from './must.ts'

const { describe, it } = window

async function open(address = '') {
  const page = await fixture<EmailCodeSignIn>(
    html`<email-code-sign-in .address=${address}></email-code-sign-in>`
  )
  const asked: string[] = []
  const checked: string[] = []
  page.start = async to => {
    asked.push(to)
  }
  page.verify = async (to, code) => {
    checked.push(`${to} ${code}`)
  }
  const root = () => page.shadowRoot as ShadowRoot
  const text = () => root().textContent ?? ''
  const field = (name: string) =>
    must(root().querySelector<HTMLInputElement>(`input[name=${name}]`))
  const press = (label: string) =>
    must([...root().querySelectorAll('button')].find(each => each.textContent?.includes(label)))
  const submit = () => must(root().querySelector('form')).requestSubmit()
  return { page, asked, checked, text, field, press, submit, root }
}

describe('email-code-sign-in', () => {
  it('starts from the address it is given, and mails the code to the one in the box', async () => {
    const { page, asked, field, submit, text } = await open('bea@example.com')
    expect(field('address').value).to.equal('bea@example.com')
    field('address').value = ' Cat@Example.com '
    submit()
    await waitUntil(() => text().includes('6-digit code'), 'the code box')
    expect(asked).to.deep.equal(['Cat@Example.com'])
    expect(page.address).to.equal('Cat@Example.com')
    expect(text()).to.contain('Cat@Example.com')
    expect(text()).to.contain('spam')
  })

  it('signs in with the code, ignoring spaces, and says so', async () => {
    const { page, checked, field, submit } = await open('bea@example.com')
    submit()
    await waitUntil(() => page.shadowRoot?.querySelector('input[name=code]'), 'the code box')
    let signedIn = 0
    page.addEventListener(SignedInEvent.type, () => signedIn++)
    field('code').value = '123 456'
    submit()
    await waitUntil(() => signedIn === 1, 'to be signed in')
    expect(checked).to.deep.equal(['bea@example.com 123456'])
  })

  const refusals: [EmailCodeError['reason'], string][] = [
    ['wrong', 'not right'],
    ['expired', 'run out'],
    ['too_many', 'Too many wrong codes'],
    ['failed', 'did not work'],
  ]
  for (const [reason, words] of refusals) {
    it(`says so when the code is refused as ${reason}, and leaves the code box to try again`, async () => {
      const { page, field, submit, text } = await open('bea@example.com')
      page.verify = async () => {
        throw new EmailCodeError(reason, 'x')
      }
      submit()
      await waitUntil(() => page.shadowRoot?.querySelector('input[name=code]'), 'the code box')
      field('code').value = '111111'
      submit()
      await waitUntil(() => text().includes(words), words)
      expect(field('code')).to.exist
    })
  }

  it('says what went wrong with the address, and with sending', async () => {
    const { page, submit, text } = await open('bea@example.com')
    page.start = async () => {
      throw new EmailCodeError('invalid_address', 'x')
    }
    submit()
    await waitUntil(() => text().includes('does not look like'), 'the address error')
    page.start = async () => {
      throw new EmailCodeError('too_often', 'x')
    }
    submit()
    await waitUntil(() => text().includes('Too many tries'), 'the rate error')
    page.start = async () => {
      throw new Error('network')
    }
    submit()
    await waitUntil(() => text().includes('could not be sent'), 'the send error')
  })

  it('sends the code again, and goes back to change the address', async () => {
    const { page, asked, press, submit, text, field } = await open('bea@example.com')
    submit()
    await waitUntil(() => page.shadowRoot?.querySelector('input[name=code]'), 'the code box')
    press('Send it again').click()
    await waitUntil(() => asked.length === 2, 'the second mail')
    await waitUntil(() => page.shadowRoot?.querySelector('input[name=code]'), 'the code box again')
    // (a resend that fails leaves them at the code box, with the reason)
    page.start = async () => {
      throw new EmailCodeError('too_often', 'x')
    }
    press('Send it again').click()
    await waitUntil(() => text().includes('Too many tries'), 'the error')
    expect(page.shadowRoot?.querySelector('input[name=code]')).to.exist
    press('different address').click()
    await waitUntil(() => page.shadowRoot?.querySelector('input[name=address]'), 'the address box')
    expect(field('address').value).to.equal('bea@example.com')
  })

  it('goes to the code box for a code they already have, asking for no new one', async () => {
    const { asked, checked, field, press, submit, text } = await open('bea@example.com')
    press('I already have a code').click()
    await waitUntil(
      () => text().includes('Enter the 6-digit code for bea@example.com'),
      'the code box'
    )
    expect(asked).to.deep.equal([])
    expect(text()).to.not.contain('We have emailed')
    field('code').value = '654321'
    submit()
    await waitUntil(() => checked.length === 1, 'to be checked')
    expect(checked).to.deep.equal(['bea@example.com 654321'])
  })

  it('wants the address before it takes a code they already have', async () => {
    const { field, press, text } = await open('')
    field('address').value = ''
    press('I already have a code').click()
    await waitUntil(() => text().includes('does not look like'), 'the error')
    field('address').value = 'not an address'
    press('I already have a code').click()
    await waitUntil(() => text().includes('does not look like'), 'the error again')
  })
})
