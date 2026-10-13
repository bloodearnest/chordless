import { offerLink } from './incoming-link.ts'
import { offerIncoming } from './incoming-songs.ts'
import { goTo } from './navigation.ts'

/**
 * The installed app being launched with something: files the system opened with it (the
 * manifest's file_handlers), or a link or shortcut for the window that is already open (its
 * launch_handler is focus-existing, so no second window is made). Chrome gives these to a
 * consumer set on window.launchQueue. Elsewhere there is no launchQueue, and nothing happens.
 */

/** What Chrome gives the launch consumer (not in the DOM types) */
interface LaunchParams {
  files?: { getFile(): Promise<File> }[]
  targetURL?: string
}

type LaunchQueue = { setConsumer(consumer: (params: LaunchParams) => void | Promise<void>): void }

export function listenForLaunches(): void {
  const queue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue
  queue?.setConsumer(handleLaunch)
}

/** @param go moves to a URL: goTo, but a test gives its own */
export async function handleLaunch(
  params: LaunchParams,
  go: (url: string) => Promise<unknown> = goTo
): Promise<void> {
  if (params.files?.length) {
    const files = await Promise.all(params.files.map(handle => handle.getFile()))
    offerIncoming({ files, text: '' })
    await go('/import-song')
    return
  }
  // A link or shortcut for the window that is open: go there (unless already there)
  if (params.targetURL) {
    const target = new URL(params.targetURL, location.href)
    // A setlist link from the email Worker holds the setlist in its fragment, which routes drop
    if (target.origin === location.origin && target.pathname === '/import-setlist' && target.hash) {
      offerLink(target.hash)
    }
    if (
      target.origin === location.origin &&
      target.pathname + target.search !== location.pathname + location.search
    ) {
      await go(target.pathname + target.search)
    }
  }
}
