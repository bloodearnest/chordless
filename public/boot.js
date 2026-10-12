// Loaded by index.html as a classic script (a file, not inline, so the Content-Security-Policy
// needs no 'unsafe-inline' for scripts)
// Set window name so bookmarklet can find and reuse this tab
window.name = 'chordless'

// Register service worker
if ('serviceWorker' in navigator) {
  // A page that loads before the service worker controls it runs without it (the
  // auth blob lives behind it), so on the very first visit reload once it is active.
  // The flag is set from the start until the page is controlled, so the page is
  // known to be settling (tests wait for it to go) and a failure cannot loop.
  const firstInstall =
    !navigator.serviceWorker.controller && !sessionStorage.getItem('sw-first-load')
  if (firstInstall) sessionStorage.setItem('sw-first-load', '1')

  navigator.serviceWorker
    .register('/service-worker.js')
    // Wait until it is active: a page that starts loading before then is not
    // controlled, and clients.claim() does not reach a page still being made
    .then(() => navigator.serviceWorker.ready)
    .then(registration => {
      console.log('Service Worker registered:', registration)
      if (firstInstall) {
        console.log('First install - reloading page to activate Service Worker')
        window.location.reload()
      } else if (navigator.serviceWorker.controller) {
        console.log('Service Worker is active and controlling page')
        sessionStorage.removeItem('sw-first-load')
      }
    })
    .catch(error => {
      console.error('Service Worker registration failed:', error)
    })
}
