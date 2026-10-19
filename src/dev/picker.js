import { getAccessToken } from '/js/google-auth.ts'

const FOLDER = 'application/vnd.google-apps.folder'

/** Load Google's Picker, once */
let pickerLoaded = null
function loadPicker() {
  pickerLoaded ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://apis.google.com/js/api.js'
    script.onerror = () => reject(new Error('Could not load the Google Picker script'))
    script.onload = () =>
      window.gapi.load('picker', {
        callback: resolve,
        onerror: () => reject(new Error('The Picker would not load')),
      })
    document.head.append(script)
  })
  return pickerLoaded
}

/** Ask the user to pick a folder (in My Drive or a shared drive): resolves with it, or null */
export async function pickFolder(apiKey, appId) {
  await loadPicker()
  const token = await getAccessToken()
  const { picker } = window.google
  return new Promise(resolve => {
    const view = new picker.DocsView(picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER)
      .setEnableDrives(true)
    new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setCallback(data => {
        if (data.action === picker.Action.PICKED) resolve(data.docs[0])
        else if (data.action === picker.Action.CANCEL) resolve(null)
      })
      .build()
      .setVisible(true)
  })
}
