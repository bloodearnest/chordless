import { expect, fixture, html } from '@open-wc/testing'
import {
  qrDataUrl,
  SetlistShare,
  SetlistShareChangeEvent,
} from '../src/components/setlist-share.ts'
import { type ChordlessDB, createSetlist, getCurrentDB } from '../src/js/db.ts'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  setCurrentOrganisation,
} from '../src/js/organisation.ts'
import { generateShareKey, setlistCode } from '../src/js/share-crypto.ts'
import '../src/components/setlist-share.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'

const { describe, it, beforeEach, afterEach } = window

describe('setlist-share', () => {
  let drive: ReturnType<typeof installFakeDrive> | undefined
  let restoreAfter = () => {}
  afterEach(() => {
    drive?.uninstall()
    restoreAfter()
    restoreAfter = () => {}
  })

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
      `${location.origin}/s/${setlist.share.fileId}#${setlist.share.key}${setlistCode(setlist.id)}`
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
      const link = `${location.origin}/s/${setlist.share.fileId}#${setlist.share.key}${setlistCode(setlist.id)}`
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

  describe('making, updating and stopping a share', () => {
    let before: { id: string | null; name: string }
    let organisationId: string
    let db: ChordlessDB
    const realOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')
    const realClipboard = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard')

    beforeEach(async () => {
      drive = installFakeDrive()
      before = getCurrentOrganisation()
      const organisation = await createOrganisation(`Share ${crypto.randomUUID().slice(0, 8)}`)
      organisationId = organisation.id
      await setCurrentOrganisation(organisation.id, organisation.name)
      db = await getCurrentDB()
    })

    afterEach(async () => {
      if (realOnLine) Object.defineProperty(Navigator.prototype, 'onLine', realOnLine)
      if (realClipboard) Object.defineProperty(Navigator.prototype, 'clipboard', realClipboard)
      delete (navigator as { onLine?: unknown }).onLine
      delete (navigator as { clipboard?: unknown }).clipboard
      db.db?.close()
      await deleteOrganisation(organisationId)
      if (before.id) await setCurrentOrganisation(before.id, before.name)
    })

    async function show(setlist = createSetlist({ date: '2099-10-11' })) {
      await db.saveSetlist(setlist)
      const el = await fixture<SetlistShare>(html`<setlist-share></setlist-share>`)
      el.setlist = setlist
      el.db = db
      await new Promise(resolve => setTimeout(resolve, 60))
      await el.updateComplete
      return { el, setlist }
    }
    const changes = (el: SetlistShare) => {
      const seen: number[] = []
      el.addEventListener(SetlistShareChangeEvent.type, () => seen.push(1))
      return seen
    }
    const press = async (el: SetlistShare, name: RegExp) => {
      const button = [...(el.shadowRoot?.querySelectorAll('button') ?? [])].find(b =>
        name.test(b.textContent ?? '')
      )
      must(button).click()
      await new Promise(resolve => setTimeout(resolve, 200))
      await el.updateComplete
    }

    it('makes the link, saves it on the setlist, and says so', async () => {
      const { el, setlist } = await show()
      const seen = changes(el)
      await press(el, /Create share link/)
      expect(seen).to.have.length(1)
      expect(setlist.share?.fileId).to.be.a('string')
      expect((await db.getSetlist(setlist.id))?.share?.fileId).to.equal(setlist.share?.fileId)
      expect(el.shadowRoot?.querySelector('input')).to.not.equal(null)
      expect(drive?.listFiles().length).to.equal(1)
    })

    it('says why it could not make the link', async () => {
      const { el } = await show()
      drive?.failRequests({ method: 'POST', path: /upload/, status: 500, times: 10 })
      await press(el, /Create share link/)
      expect(text(el)).to.include("Couldn't do that")
      expect(el._busy).to.equal(false)
    })

    it('says to connect when it is offline', async () => {
      const { el } = await show()
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
      drive?.failRequests({ method: 'POST', path: /upload/, status: 500, times: 10 })
      await press(el, /Create share link/)
      expect(text(el)).to.include("You're offline")
    })

    it('does nothing with no setlist or database, or while it is busy', async () => {
      const el = await fixture<SetlistShare>(html`<setlist-share></setlist-share>`)
      let ran = 0
      await el._run(async () => {
        ran++
      })
      const { el: other } = await show()
      other._busy = true
      await other._run(async () => {
        ran++
      })
      expect(ran).to.equal(0)
    })

    it('updates a share that is made, when asked', async () => {
      const { el, setlist } = await show()
      await press(el, /Create share link/)
      const seen = changes(el)
      await press(el, /Update now/)
      expect(seen).to.have.length(1)
      expect(setlist.share).to.not.equal(null)
    })

    it('saves the share again when the setlist has changed since', async () => {
      const { el, setlist } = await show()
      await press(el, /Create share link/)
      const hash = must(setlist.share).bundleHash
      setlist.name = 'Changed since it was shared'
      await db.saveSetlist(setlist)
      await press(el, /Update now/)
      expect(must(setlist.share).bundleHash).to.not.equal(hash)
      expect(must(await db.getSetlist(setlist.id)).share?.bundleHash).to.equal(
        must(setlist.share).bundleHash
      )
    })

    it('has nothing to update without a share', async () => {
      const { el } = await show()
      must(el._stopModal.value).ask = async () => true
      await el._update()
      await el._stop()
      expect(el._error).to.equal('')
    })

    it('stops sharing when it is told to, and not when it is not', async () => {
      const { el, setlist } = await show()
      await press(el, /Create share link/)
      const modal = must(el._stopModal.value)
      modal.ask = async () => false
      await press(el, /Stop sharing/)
      expect(setlist.share).to.not.equal(null)
      modal.ask = async () => true
      const seen = changes(el)
      await press(el, /Stop sharing/)
      expect(setlist.share).to.equal(null)
      expect(seen).to.have.length(1)
      expect((await db.getSetlist(setlist.id))?.share).to.equal(null)
    })

    it('copies the link, and shows it has', async () => {
      const { el } = await show()
      await press(el, /Create share link/)
      const realMs = SetlistShare.copiedMs
      SetlistShare.copiedMs = 30
      restoreAfter = () => {
        SetlistShare.copiedMs = realMs
      }
      const written: string[] = []
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async (text: string) => written.push(text) },
        configurable: true,
      })
      el.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="Copy link"]')?.click()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(written).to.deep.equal([el._url])
      expect(el._copied).to.equal(true)
      await new Promise(resolve => setTimeout(resolve, 60))
      expect(el._copied).to.equal(false)
    })

    it('selects the link for the user when it cannot copy it', async () => {
      const { el } = await show()
      await press(el, /Create share link/)
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async () => {
            throw new Error('refused')
          },
        },
        configurable: true,
      })
      await el._copy()
      expect(el._copied).to.equal(false)
    })

    it('sends the link with the share sheet, and does not mind it being cancelled', async () => {
      const { el } = await show()
      await press(el, /Create share link/)
      const sent: Array<{ url: string }> = []
      const had = Object.getOwnPropertyDescriptor(navigator, 'share')
      Object.defineProperty(navigator, 'share', {
        value: async (data: { url: string }) => {
          sent.push(data)
        },
        configurable: true,
      })
      try {
        await el._send()
        expect(sent[0].url).to.equal(el._url)
        Object.defineProperty(navigator, 'share', {
          value: async () => {
            throw new DOMException('cancelled', 'AbortError')
          },
          configurable: true,
        })
        await el._send()
        el.setlist = null
        await el._send()
      } finally {
        if (had) Object.defineProperty(navigator, 'share', had)
        else delete (navigator as { share?: unknown }).share
      }
    })

    it('has no link, or message, before there is a share', async () => {
      const el = await fixture<SetlistShare>(html`<setlist-share></setlist-share>`)
      expect(el._url).to.equal('')
      expect(el._message).to.equal('')
      expect(el._gmail).to.contain('Setlist%3A%20')
    })

    it('shows nothing when it has no setlist', async () => {
      const el = await fixture<SetlistShare>(html`<setlist-share></setlist-share>`)
      expect(el.shadowRoot?.querySelector('app-modal')).to.equal(null)
    })
  })
})
