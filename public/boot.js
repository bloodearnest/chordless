// Loaded by index.html as a classic script (a file, not inline, so the Content-Security-Policy
// needs no 'unsafe-inline' for scripts)
// Set window name so bookmarklet can find and reuse this tab
window.name = 'chordless'

// Register service worker (not below the floor: floor.js has shown its message)
if ('serviceWorker' in navigator && !window.chordlessBelowFloor) {
  // The page should be controlled by the service worker (the auth blob lives behind it). On
  // the first visit the worker takes control of the open page itself (clients.claim()), which
  // is quick where it works. Where it does not reach a page that began loading before the
  // worker was active (some browsers), reload once instead, so the page is controlled.
  // The flag is set from the start until the page is controlled, so the page is known to be
  // settling (tests wait for it to go) and a failure cannot loop.
  const CLAIM_WAIT_MS = 2000
  const firstInstall =
    !navigator.serviceWorker.controller && !sessionStorage.getItem('sw-first-load')
  if (firstInstall) sessionStorage.setItem('sw-first-load', '1')

  /** Resolve true when the page is controlled, or false after waiting for the worker to claim it */
  const controlled = () =>
    new Promise(resolve => {
      if (navigator.serviceWorker.controller) return resolve(true)
      const timer = setTimeout(() => resolve(false), CLAIM_WAIT_MS)
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => {
          clearTimeout(timer)
          resolve(true)
        },
        { once: true }
      )
    })

  navigator.serviceWorker
    .register('/service-worker.js')
    // Wait until it is active: only an active worker can claim the page
    .then(() => navigator.serviceWorker.ready)
    .then(async registration => {
      console.log('Service Worker registered:', registration)
      if (await controlled()) {
        console.log('Service Worker is active and controlling page')
        sessionStorage.removeItem('sw-first-load')
      } else if (firstInstall) {
        console.log('First install - reloading page to activate Service Worker')
        window.location.reload()
      }
    })
    .catch(error => {
      console.error('Service Worker registration failed:', error)
    })
}
