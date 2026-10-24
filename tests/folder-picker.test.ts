/**
 * Choosing a Drive folder (folder-picker.ts). Google's script, its Picker and the Worker's
 * /api/config are stubs; the service worker that keeps the sign-in is a fake one.
 */
import { expect } from '@open-wc/testing'
import { pickFolder } from '../src/js/folder-picker.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

type Callback = (data: Record<string, unknown>) => void

describe('pickFolder', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  const realFetch = window.fetch
  const win = window as unknown as { gapi?: unknown; google?: unknown }
  const real = { gapi: win.gapi, google: win.google }
  let config: () => Response
  /** What the stub Picker was built with, and what it is told to answer */
  let built: Record<string, unknown>
  let answer: (callback: Callback) => void

  beforeEach(() => {
    ;({ worker, uninstall: uninstallWorker } = installFakeAuthWorker())
    worker.stored = {
      blob: 'blob',
      metadata: {
        access_token: 'the-token',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        scope: 'https://www.googleapis.com/auth/drive.file openid email profile',
      },
      updated_at: new Date().toISOString(),
    }
    built = {}
    config = () => Response.json({ pickerApiKey: 'the-key' })
    answer = callback => callback({ action: 'picked', docs: [{ id: 'f1', name: 'Church Drive' }] })
    window.fetch = (async (input: RequestInfo | URL) =>
      String(input) === '/api/config' ? config() : realFetch(input)) as typeof fetch

    const view: Record<string, unknown> = {
      setIncludeFolders: () => view,
      setSelectFolderEnabled: () => view,
      setEnableDrives: () => view,
      setMimeTypes: () => view,
    }
    const builder: Record<string, unknown> = {}
    for (const method of [
      'addView',
      'enableFeature',
      'setAppId',
      'setDeveloperKey',
      'setOAuthToken',
      'setTitle',
    ]) {
      builder[method] = (value: unknown) => {
        built[method] = value
        return builder
      }
    }
    builder.setCallback = (callback: Callback) => {
      built.callback = callback
      return builder
    }
    builder.build = () => ({ setVisible: () => answer(built.callback as Callback) })
    win.gapi = { load: (_api: string, options: { callback: () => void }) => options.callback() }
    win.google = {
      picker: {
        ViewId: { FOLDERS: 'folders' },
        DocsView: function DocsView() {
          return view
        },
        PickerBuilder: function PickerBuilder() {
          return builder
        },
        Action: { PICKED: 'picked', CANCEL: 'cancel' },
        Response: { ACTION: 'action', DOCUMENTS: 'docs' },
        Document: { ID: 'id', NAME: 'name' },
        Feature: { SUPPORT_DRIVES: 'support-drives' },
      },
    }
  })

  afterEach(() => {
    window.fetch = realFetch
    win.gapi = real.gapi
    win.google = real.google
    uninstallWorker()
  })

  it('asks for a folder with the person’s own access and the server’s key, and gives its id and name', async () => {
    expect(await pickFolder('Pick one')).to.deep.equal({ id: 'f1', name: 'Church Drive' })
    expect(built.setDeveloperKey).to.equal('the-key')
    expect(built.setOAuthToken).to.equal('the-token')
    // (the dev project's number, from .env.development, as the page has it under `npm run dev`)
    expect(built.setAppId).to.equal(import.meta.env?.VITE_PICKER_APP_ID)
    expect(built.setAppId).to.match(/^\d+$/)
    expect(built.enableFeature).to.equal('support-drives')
    expect(built.setTitle).to.equal('Pick one')
  })

  it('gives null when they cancel, and waits while they have not chosen yet', async () => {
    answer = callback => {
      callback({ action: 'loaded' })
      callback({ action: 'cancel' })
    }
    expect(await pickFolder()).to.equal(null)
  })

  it('gives null when it picked nothing', async () => {
    answer = callback => callback({ action: 'picked', docs: [] })
    expect(await pickFolder()).to.equal(null)
  })

  it('says when the server has no key', async () => {
    config = () => Response.json({ pickerApiKey: null })
    const error = await pickFolder().catch(failure => failure)
    expect((error as Error).message).to.match(/not set up on this server/)
    config = () => new Response('no', { status: 503 })
    const failed = await pickFolder().catch(failure => failure)
    expect((failed as Error).message).to.match(/not set up on this server/)
  })

  it('says so when Google’s script loads without a picker in it', async () => {
    win.google = {}
    const error = await pickFolder().catch(failure => failure)
    expect((error as Error).message).to.match(/Are you offline/)
  })

  it('says when Google’s picker would not load', async () => {
    win.gapi = {
      load: (_api: string, options: { onerror: () => void }) => options.onerror(),
    }
    const error = await pickFolder().catch(failure => failure)
    expect((error as Error).message).to.match(/Couldn't load Google's folder picker/)
  })

  describe('when Google’s script is not on the page yet', () => {
    const realAppend = document.head.appendChild.bind(document.head)
    let loaded: HTMLScriptElement[]
    let gapi: unknown

    beforeEach(() => {
      gapi = win.gapi
      win.gapi = undefined
      loaded = []
      // (the script is never fetched: the test says when it has loaded, or not)
      document.head.appendChild = (<T extends Node>(node: T): T => {
        if (node instanceof HTMLScriptElement && node.src.includes('apis.google.com')) {
          loaded.push(node)
          node.type = 'text/plain' // (so the browser does not run or fetch it)
          return realAppend(node)
        }
        return realAppend(node)
      }) as typeof document.head.appendChild
    })

    afterEach(() => {
      document.head.appendChild = realAppend
      for (const script of loaded) script.remove()
    })

    it('adds it once for calls that come together, and goes on when it has loaded', async () => {
      const first = pickFolder()
      const second = pickFolder()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(loaded).to.have.length(1)
      win.gapi = gapi
      loaded[0].dispatchEvent(new Event('load'))
      expect(await first).to.deep.equal({ id: 'f1', name: 'Church Drive' })
      expect(await second).to.deep.equal({ id: 'f1', name: 'Church Drive' })
    })

    it('says so when it could not be loaded, and leaves nothing to stop another try', async () => {
      const failing = pickFolder()
      await new Promise(resolve => setTimeout(resolve, 20))
      loaded[0].dispatchEvent(new Event('error'))
      const error = await failing.catch(failure => failure)
      expect((error as Error).message).to.match(/Are you offline/)
    })
  })
})
