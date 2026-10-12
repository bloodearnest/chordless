import { expect, fixture, html } from '@open-wc/testing'
import { qrDataUrl, type SetlistShare } from '../src/components/setlist-share.ts'
import { createSetlist } from '../src/js/db.ts'
import { generateShareKey } from '../src/js/share-crypto.ts'
import '../src/components/setlist-share.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'

const { describe, it, afterEach } = window

describe('setlist-share', () => {
  let drive: ReturnType<typeof installFakeDrive> | undefined
  afterEach(() => drive?.uninstall())

  const shared = () => {
    const key = generateShareKey()
    return {
      ...createSetlist({ date: '2026-10-11' }),
      share: {
        fileId: 'file-id-1234567890',
        key,
        created: '2026-10-05',
        expires: '2026-10-25',
        bundleHash: 'h',
      },
    }
  }

  const text = (el: Element) => must(el.shadowRoot).textContent?.replace(/\s+/g, ' ')

  it('makes a QR code as an image', () => {
    const url = qrDataUrl('https://chordless.app/s/abc#key')
    expect(url).to.match(/^data:image\/gif;base64,/)
    expect(qrDataUrl('https://chordless.app/s/abd#key')).to.not.equal(url)
  })

  it('shows the link, a QR code, the end date and the ways to use it', async () => {
    drive = installFakeDrive()
    const setlist = shared()
    const el = await fixture<SetlistShare>(
      html`<setlist-share .setlist=${setlist}></setlist-share>`
    )
    await el.updateComplete

    const input = must(el.shadowRoot?.querySelector('input'))
    expect(input.value).to.equal(
      `${location.origin}/s/${setlist.share.fileId}#${setlist.share.key}`
    )
    expect(must(el.shadowRoot?.querySelector('img')).src).to.match(/^data:image\/gif/)
    expect(text(el)).to.include('Ends after')
    expect(text(el)).to.include('Copy link')
    expect(text(el)).to.include('Stop sharing')
  })

  it('offers to make a link to someone signed in to Google', async () => {
    drive = installFakeDrive()
    const setlist = createSetlist({ date: '2026-10-11' })
    const el = await fixture<SetlistShare>(
      html`<setlist-share .setlist=${setlist}></setlist-share>`
    )
    await new Promise(resolve => setTimeout(resolve, 50))
    await el.updateComplete
    expect(text(el)).to.include('Create share link')
    expect(el.shadowRoot?.querySelector('input')).to.equal(null)
  })

  it('says to sign in when there is no Google connection', async () => {
    const setlist = createSetlist({ date: '2026-10-11' })
    const el = await fixture<SetlistShare>(
      html`<setlist-share .setlist=${setlist}></setlist-share>`
    )
    await new Promise(resolve => setTimeout(resolve, 50))
    await el.updateComplete
    expect(text(el)).to.include('Sign in with Google')
  })
})
