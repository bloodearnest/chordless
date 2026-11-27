import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import {
  qrDataUrl,
  SetlistShare,
  SetlistShareChangeEvent,
} from '../src/components/setlist-share.ts'
import { type ChordlessDB, createSetlist, getCurrentDB } from '../src/js/db.ts'
import { generateShareKey, setlistCode } from '../src/js/share-crypto.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  setCurrentSpace,
  updateSpace,
} from '../src/js/space.ts'
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
    expect(text(el)).to.include('Connect Google Drive')
  })

  describe('making, updating and stopping a share', () => {
    let before: { id: string | null; name: string }
    let spaceId: string
    let db: ChordlessDB
    const realOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')
    const realClipboard = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard')

    beforeEach(async () => {
      drive = installFakeDrive()
      before = getCurrentSpace()
      const space = await createSpace(`Share ${crypto.randomUUID().slice(0, 8)}`)
      spaceId = space.id
      await setCurrentSpace(space.id, space.name)
      db = await getCurrentDB()
    })

    afterEach(async () => {
      if (realOnLine) Object.defineProperty(Navigator.prototype, 'onLine', realOnLine)
      if (realClipboard) Object.defineProperty(Navigator.prototype, 'clipboard', realClipboard)
      delete (navigator as { onLine?: unknown }).onLine
      delete (navigator as { clipboard?: unknown }).clipboard
      db.db?.close()
      await deleteSpace(spaceId)
      if (before.id) await setCurrentSpace(before.id, before.name)
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

    describe('a space that has moved to Chordless', () => {
      /** The Worker's share routes, as far as the dialog uses them */
      function worker(initial: { shareId: string; expiresAt: string } | null = null) {
        const state = { share: initial, calls: [] as string[], fail: null as number | null }
        const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input))
          const call = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`
          state.calls.push(call)
          if (state.fail && init?.method === 'POST')
            return Response.json({ error: 'Not allowed' }, { status: state.fail })
          if (init?.method === 'POST') {
            state.share = state.share ?? {
              shareId: 'sh_aaaaaaaaaaaaaaaaaaaaaa',
              expiresAt: '2099-10-25T23:59:59.999Z',
            }
            return Response.json(state.share, { status: 201 })
          }
          if (init?.method === 'DELETE') {
            state.share = null
            return new Response(null, { status: 204 })
          }
          return state.share
            ? Response.json(state.share)
            : Response.json({ error: 'None' }, { status: 404 })
        }) as typeof window.fetch
        return { state, fetch }
      }

      async function showMoved(server: ReturnType<typeof worker>, synced: string[] = []) {
        await updateSpace(spaceId, {
          server: { libraryId: 'library', movedAt: '2026-11-25T00:00:00.000Z' },
        })
        const setlist = createSetlist({ date: '2099-10-11' })
        await db.saveSetlist(setlist)
        const el = await fixture<SetlistShare>(html`<setlist-share></setlist-share>`)
        el.connection = () => ({
          token: async () => 'token',
          origin: location.origin,
          fetch: server.fetch,
        })
        el.syncFirst = async id => {
          synced.push(id)
        }
        el.db = db
        el.setlist = setlist
        await waitUntil(() => server.state.calls.length > 0, 'the check', { timeout: 3000 })
        await new Promise(resolve => setTimeout(resolve, 50))
        await el.updateComplete
        return { el, setlist }
      }

      const labels = (el: SetlistShare) =>
        [...(el.shadowRoot?.querySelectorAll('button') ?? [])].map(b => b.textContent?.trim())

      it('asks the Worker whether it is shared, and offers to make a link when it is not', async () => {
        const server = worker()
        const { el } = await showMoved(server)
        expect(server.state.calls[0]).to.match(/^GET \/api\/shares\?setlistId=/)
        expect(el.shared).to.equal(false)
        expect(labels(el)).to.include('Create share link')
        expect(text(el)).to.include('always shows the setlist as it is now')
      })

      it('syncs the setlist, makes the link with no key in it, and says it is shared', async () => {
        const server = worker()
        const synced: string[] = []
        const { el } = await showMoved(server, synced)
        const seen = changes(el)
        await press(el, /Create share link/)
        expect(synced).to.deep.equal([spaceId])
        expect(server.state.calls).to.include('POST /api/shares')
        expect(el._url).to.equal(`${location.origin}/s/sh_aaaaaaaaaaaaaaaaaaaaaa`)
        expect(el.shared).to.equal(true)
        expect(seen.length).to.be.greaterThan(0)
        expect(el.shadowRoot?.querySelector('input')).to.not.equal(null)
        expect(text(el)).to.include('Ends after')
        expect(labels(el)).to.not.include('Update now')
        expect(labels(el)).to.include('Stop sharing')
      })

      it('shows a link another device made, and stops it after asking', async () => {
        const server = worker({
          shareId: 'sh_bbbbbbbbbbbbbbbbbbbbbb',
          expiresAt: '2099-10-25T23:59:59.999Z',
        })
        const { el } = await showMoved(server)
        expect(el.shared).to.equal(true)
        expect(el._url).to.equal(`${location.origin}/s/sh_bbbbbbbbbbbbbbbbbbbbbb`)
        const stopping = press(el, /Stop sharing/)
        const confirm = must(el._stopModal.value)
        await waitUntil(() => confirm.open, 'the question', { timeout: 3000 })
        must(confirm.shadowRoot?.querySelector<HTMLElement>('.modal-btn-confirm')).click()
        await stopping
        await waitUntil(() => !el.shared, 'it stopped', { timeout: 3000 })
        expect(server.state.calls).to.include('DELETE /api/shares/sh_bbbbbbbbbbbbbbbbbbbbbb')
        expect(labels(el)).to.include('Create share link')
      })

      it('takes the link a setlist already has when another device made one first', async () => {
        const server = worker()
        const { el } = await showMoved(server)
        server.state.share = {
          shareId: 'sh_cccccccccccccccccccccc',
          expiresAt: '2099-10-25T23:59:59.999Z',
        }
        // (the Worker says it is already shared: the dialog shows that link)
        const fetch = server.fetch
        let first = true
        el.connection = () => ({
          token: async () => 't',
          origin: location.origin,
          fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'POST' && first) {
              first = false
              return Response.json({ error: 'This setlist is already shared' }, { status: 409 })
            }
            return fetch(input, init)
          }) as typeof window.fetch,
        })
        await press(el, /Create share link/)
        expect(el._url).to.contain('sh_cccccccccccccccccccccc')
      })

      it('says why it could not make the link', async () => {
        const server = worker()
        const { el } = await showMoved(server)
        server.state.fail = 403
        await press(el, /Create share link/)
        expect(text(el)).to.include("Couldn't do that")
        expect(el.shared).to.equal(false)
      })

      it('says it is not known whether it is shared when the Worker cannot be asked', async () => {
        await updateSpace(spaceId, {
          server: { libraryId: 'library', movedAt: '2026-11-25T00:00:00.000Z' },
        })
        const setlist = createSetlist({ date: '2099-10-11' })
        await db.saveSetlist(setlist)
        const el = await fixture<SetlistShare>(html`<setlist-share></setlist-share>`)
        let asked = 0
        el.connection = () => ({
          token: async () => 't',
          origin: location.origin,
          fetch: (async () => {
            asked++
            return Response.json({ error: 'Down' }, { status: 500 })
          }) as typeof window.fetch,
        })
        el.db = db
        el.setlist = setlist
        await waitUntil(() => asked > 0, 'the check', { timeout: 3000 })
        await el.updateComplete
        expect(text(el)).to.include('Checking whether it is shared')
        expect(el.shared).to.equal(false)
      })

      it('says it is offline, rather than that it is not shared, when it cannot ask', async () => {
        await updateSpace(spaceId, {
          server: { libraryId: 'library', movedAt: '2026-11-25T00:00:00.000Z' },
        })
        const setlist = createSetlist({ date: '2099-10-11' })
        await db.saveSetlist(setlist)
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
        const el = await fixture<SetlistShare>(html`<setlist-share></setlist-share>`)
        el.db = db
        el.setlist = setlist
        await waitUntil(() => el._moved, 'the space', { timeout: 3000 })
        await el.updateComplete
        expect(text(el)).to.include("You're offline")
        expect(el.shared).to.equal(false)
      })

      it('shows a link made before the move, to a Drive file, and stops it as before', async () => {
        const server = worker()
        const { el, setlist } = await showMoved(server)
        setlist.share = shared().share
        el.requestUpdate()
        await el.updateComplete
        expect(el.shadowRoot?.querySelector('input')).to.not.equal(null)
        expect(labels(el)).to.not.include('Update now')
        expect(labels(el)).to.include('Stop sharing')
        expect(el.shared).to.equal(true)
      })
    })

    it('says nothing of how to share until it knows what kind of space it is, then offers the link', async () => {
      const setlist = createSetlist({ date: '2099-10-11' })
      const el = document.createElement('setlist-share') as SetlistShare
      el.setlist = setlist
      document.body.append(el)
      try {
        await el.updateComplete
        // (the first render comes before the question to the database is answered)
        expect(el._knowsSpace).to.equal(false)
        expect(el.shadowRoot?.querySelector('#share-checking')).to.not.equal(null)
        await waitUntil(() => el._knowsSpace, 'the space to be known', { timeout: 3000 })
        await el.updateComplete
        expect(el.shadowRoot?.querySelector('#share-checking')).to.equal(null)
      } finally {
        el.remove()
      }
    })

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
