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
    expect(el.shadowRoot?.querySelector('button[aria-label="Copy link"]')).to.not.equal(null)
  })

  it('has Update now and Stop sharing in its modal, and opens with show()', async () => {
    drive = installFakeDrive()
    const el = await fixture<SetlistShare>(
      html`<setlist-share .setlist=${shared()}></setlist-share>`
    )
    const modal = must(el.shadowRoot?.querySelector<HTMLElement & { open: boolean }>('app-modal'))
    expect(modal.open).to.equal(false)
    el.show()
    await el.updateComplete
    expect(modal.open).to.equal(true)
    expect(modal.querySelector('input')).to.not.equal(null)
    expect(modal.textContent).to.include('Update now')
    expect(modal.textContent).to.include('Stop sharing')
    expect(modal.querySelectorAll('button[aria-label="Copy link"]')).to.have.length(1)
  })

  /** Pretend the browser has (or has not) a share sheet, for one test */
  const withShareSheet = async (has: boolean, test: () => Promise<void>) => {
    const had = Object.getOwnPropertyDescriptor(navigator, 'share')
    Object.defineProperty(navigator, 'share', {
      value: has ? async () => {} : undefined,
      configurable: true,
    })
    try {
      await test()
    } finally {
      if (had) Object.defineProperty(navigator, 'share', had)
      else delete (navigator as { share?: unknown }).share
    }
  }

  it('with a share sheet, offers Share to… and no links to particular apps', async () => {
    await withShareSheet(true, async () => {
      drive = installFakeDrive()
      const el = await fixture<SetlistShare>(
        html`<setlist-share .setlist=${shared()}></setlist-share>`
      )
      expect(el.shadowRoot?.querySelector('#share-to')).to.not.equal(null)
      expect(el.shadowRoot?.querySelector('#share-whatsapp, #share-gmail')).to.equal(null)
    })
  })

  it('with no share sheet, links to WhatsApp and Gmail with the link in the message', async () => {
    await withShareSheet(false, async () => {
      drive = installFakeDrive()
      const setlist = shared()
      const el = await fixture<SetlistShare>(
        html`<setlist-share .setlist=${setlist}></setlist-share>`
      )
      expect(el.shadowRoot?.querySelector('#share-to')).to.equal(null)
      const link = `${location.origin}/s/${setlist.share.fileId}#${setlist.share.key}`
      const whatsapp = new URL(
        must(el.shadowRoot?.querySelector<HTMLAnchorElement>('#share-whatsapp')).href
      )
      expect(whatsapp.origin).to.equal('https://wa.me')
      expect(whatsapp.searchParams.get('text')).to.include(link)
      const gmail = new URL(
        must(el.shadowRoot?.querySelector<HTMLAnchorElement>('#share-gmail')).href
      )
      expect(gmail.origin).to.equal('https://mail.google.com')
      expect(gmail.searchParams.get('su')).to.match(/^Setlist: /)
      expect(gmail.searchParams.get('body')).to.include(link)
    })
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
