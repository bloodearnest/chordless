/**
 * Installing Chordless to the home screen (or dock): which way this browser offers, and the
 * Chromium install prompt, which is only fired once, early, so it is caught as the app starts
 * (app.ts imports this) and kept until something asks for it.
 */

/** How the user can install the app here, if at all */
export type InstallMode =
  /** Already running as an installed app */
  | 'installed'
  /** The browser has an install prompt to show (Chrome, Edge) */
  | 'prompt'
  /** iPhone and iPad: Share, then Add to Home Screen (there is no API) */
  | 'ios'
  /** Safari on a Mac: File, then Add to Dock (there is no API) */
  | 'mac-safari'
  /** No way to install from here (Firefox, say) */
  | 'none'

/** What the mode is worked out from, so it can be tested */
export interface InstallEnvironment {
  standalone: boolean
  hasPrompt: boolean
  userAgent: string
  maxTouchPoints: number
}

/** Chromium's install prompt event (not in the DOM types) */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function installModeFor(env: InstallEnvironment): InstallMode {
  if (env.standalone) return 'installed'
  if (env.hasPrompt) return 'prompt'
  const { userAgent } = env
  // iPadOS reports itself as a Mac, but a Mac has no touch screen
  const isIos =
    /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && env.maxTouchPoints > 1)
  if (isIos) return 'ios'
  const isSafari =
    /Safari\//.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(userAgent)
  if (/Macintosh/.test(userAgent) && isSafari) return 'mac-safari'
  return 'none'
}

/** Fired on window when the mode may have changed (the prompt arrived, or the app was installed) */
export const INSTALL_CHANGE_EVENT = 'chordless:install-change'

let deferredPrompt: BeforeInstallPromptEvent | null = null
let installed = false

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault()
  deferredPrompt = event as BeforeInstallPromptEvent
  window.dispatchEvent(new Event(INSTALL_CHANGE_EVENT))
})

window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  installed = true
  window.dispatchEvent(new Event(INSTALL_CHANGE_EVENT))
})

export function currentInstallMode(): InstallMode {
  return installModeFor({
    standalone:
      installed ||
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    hasPrompt: deferredPrompt !== null,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  })
}

/** Show the browser's install prompt. @returns whether the user accepted */
export async function promptInstall(): Promise<boolean> {
  const prompt = deferredPrompt
  if (!prompt) return false
  // It can be used once
  deferredPrompt = null
  await prompt.prompt()
  const { outcome } = await prompt.userChoice
  window.dispatchEvent(new Event(INSTALL_CHANGE_EVENT))
  return outcome === 'accepted'
}
