/**
 * Choosing a Drive folder with the Google Picker (docs/SPACES.md, "Creating a team space"): the
 * parent of a new team space's folder, in My Drive or on a shared drive. The Picker is Google's
 * own page in a frame, so nothing of the folder's contents comes to the app, only the folder's id
 * and name. Under `drive.file` a picked folder alone exposes no children, which is why the app
 * makes the team folder inside it.
 */
import { getAccessToken } from './google-auth.ts'

/**
 * The browser key for the Picker (Terraform: `google_apikeys_key.team`, "Team Key") comes from the
 * Worker (`PICKER_API_KEY` in .dev.vars, and as a secret in production): it only works for the
 * Picker API, from our own addresses, so it is no secret, but it is set in one place.
 */
async function pickerApiKey(): Promise<string> {
  const response = await fetch('/api/config')
  const { pickerApiKey } = response.ok ? await response.json() : { pickerApiKey: null }
  if (typeof pickerApiKey !== 'string' || !pickerApiKey) {
    throw new Error('The folder picker is not set up on this server (no PICKER_API_KEY)')
  }
  return pickerApiKey
}

/** The Picker's app id: the Google Cloud project number of `chordless-app` */
const PICKER_APP_ID = '818185619377'

const GAPI_URL = 'https://apis.google.com/js/api.js'

export interface PickedFolder {
  id: string
  name: string
}

/** The part of Google's Picker that is used here (it ships no types we depend on) */
interface PickerApi {
  ViewId: { FOLDERS: string }
  DocsView: new (viewId?: string) => PickerView
  PickerBuilder: new () => PickerBuilder
  Action: { PICKED: string; CANCEL: string }
  Response: { ACTION: string; DOCUMENTS: string }
  Document: { ID: string; NAME: string }
  Feature: { SUPPORT_DRIVES: string }
}
interface PickerView {
  setIncludeFolders(on: boolean): PickerView
  setSelectFolderEnabled(on: boolean): PickerView
  setEnableDrives(on: boolean): PickerView
  setMimeTypes(types: string): PickerView
}
interface PickerBuilder {
  addView(view: PickerView): PickerBuilder
  enableFeature(feature: string): PickerBuilder
  setAppId(id: string): PickerBuilder
  setDeveloperKey(key: string): PickerBuilder
  setOAuthToken(token: string): PickerBuilder
  setTitle(title: string): PickerBuilder
  setCallback(callback: (data: Record<string, unknown>) => void): PickerBuilder
  build(): { setVisible(visible: boolean): void }
}
interface Gapi {
  load(api: string, options: { callback: () => void; onerror: () => void }): void
}
type PickerWindow = Window & { gapi?: Gapi; google?: { picker?: PickerApi } }

/** Google's script, loaded once: a second call waits for the script tag already on the page */
function loadScript(win: PickerWindow): Promise<void> {
  if (win.gapi) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const fail = (script: HTMLScriptElement) => {
      script.remove() // so trying again loads it afresh
      reject(new Error("Couldn't load Google's folder picker. Are you offline?"))
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${GAPI_URL}"]`)
    const added = !script
    if (!script) {
      script = document.createElement('script')
      script.src = GAPI_URL
      script.async = true
    }
    const tag = script
    tag.addEventListener('load', () => resolve())
    tag.addEventListener('error', () => fail(tag))
    if (added) document.head.appendChild(tag)
  })
}

/** Load Google's script and its Picker module */
async function loadPicker(): Promise<PickerApi> {
  const win = window as PickerWindow
  await loadScript(win)
  return new Promise<PickerApi>((resolve, reject) => {
    const fail = () => reject(new Error("Couldn't load Google's folder picker. Are you offline?"))
    win.gapi?.load('picker', {
      callback: () => {
        const picker = win.google?.picker
        if (picker) resolve(picker)
        else fail()
      },
      onerror: fail,
    })
  })
}

/**
 * Ask the person to pick a folder: their My Drive or any shared drive they can reach.
 * Resolves with the folder, or null if they cancelled.
 * @throws if the Picker could not be loaded, or the key is not set
 */
export async function pickFolder(
  title = 'Choose where to keep the team space'
): Promise<PickedFolder | null> {
  const [picker, token, key] = await Promise.all([loadPicker(), getAccessToken(), pickerApiKey()])

  const view = new picker.DocsView(picker.ViewId.FOLDERS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(true)
    .setEnableDrives(true)
    .setMimeTypes('application/vnd.google-apps.folder')

  return new Promise<PickedFolder | null>(resolve => {
    new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setAppId(PICKER_APP_ID)
      .setDeveloperKey(key)
      .setOAuthToken(token)
      .setTitle(title)
      .setCallback(data => {
        const action = data[picker.Response.ACTION]
        if (action === picker.Action.CANCEL) return resolve(null)
        if (action !== picker.Action.PICKED) return
        const documents = data[picker.Response.DOCUMENTS] as Record<string, string>[] | undefined
        const folder = documents?.[0]
        if (!folder) return resolve(null)
        resolve({ id: folder[picker.Document.ID], name: folder[picker.Document.NAME] })
      })
      .build()
      .setVisible(true)
  })
}
