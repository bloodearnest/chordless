# Offline use and storage eviction

Status: the install steps on the welcome card are built; the install nag and the recovery below are **plans,
not built**. The TODO has the one-line items.

## The usage to design for

Usage pattern to design for: a dedicated iPad opened every 3 to 4 weeks, often on poor wifi.
So: the app must open offline from its cache (done: the build precaches everything,
tests/built.playwright.ts), data must survive the weeks between (the install nag, below), and
a signed-in session and the Drive link must still work after weeks (test an expired token with
no network: local setlists must still show)

## Safari clears a site's storage

install nag ("install to keep your data on this device"). The welcome card (a new user's home
page) already has an "Install it" step with the reason and the per-platform instructions
(src/js/install.ts has the detection and the Chromium prompt): this is the nag that keeps asking
after that, below. this will be important for a dedicated church
iPad that is only opened when its owner is on the rota (every 3 to 4 weeks). Safari (iOS, and
macOS) deletes a site's script-writable storage (IndexedDB, localStorage, the service worker
and its caches) after 7 days of Safari use without the user interacting with the site (days
the browser is used, not calendar days: a rarely used iPad is not wiped just by sitting idle,
but Safari use on other days counts; WebKit's "Full Third-Party Cookie Blocking and More"
post, 2020; not re-checked since) unless the site is added to the Home Screen, which has its
own counter. What is lost: the sign-in, the space's Drive folder link, unsynced changes, settings
and pads, and at church, with poor wifi, the setlists are gone until signed in and synced.
On iOS and iPadOS in a Safari tab (not navigator.standalone) it should INSIST: not a corner
banner that "Not now" dismisses for weeks, but a sheet over the home page that explains the
risk in one line and walks through Share › Add to Home Screen, back each time the app is
opened in Safari until it is installed. Allow "Continue in Safari anyway" for that visit only
(people borrow an iPad, or are mid-rota). Never over a setlist (the home page only). Detect
iOS with the user agent or, for iPadOS (which reports as a Mac), maxTouchPoints > 1.
The platform detection, the Chromium prompt and the instructions already exist in
src/js/install.ts and the welcome card: reuse them. Skip when already installed. Installing
also lets Chrome grant persistent storage.

## Recovering after the storage has been cleared

recover when Safari has cleared the storage: the nag is the prevention, this is the cure.
The JWE key stays in the worker (JWE_ENCRYPTION_KEY): the worker needs it to decrypt the blob
and use the Google refresh token, and the browser must never hold it. What the browser holds
is the encrypted blob in IndexedDB (auth-db.ts), and that is what an eviction deletes, along
with the spaces and their Drive-folder links (space-db.ts), the songs and
setlists (db.ts) and the current-space marker (localStorage). So there is nothing on the device
to restore from: recovery needs either the user or the server.
- Plan (decided): the server keeps a copy of the blob in a cookie, and the app restores from it.
  - the worker also sets the blob as an HttpOnly, Secure, SameSite=Lax cookie (Path=/session,
    long Max-Age) on /oauth/callback, and clears it on /session/revoke. WebKit's tracking
    prevention (webkit.org/tracking-prevention) caps cookies created in JavaScript, not
    Set-Cookie ones (except under CNAME cloaking to a third party), so it survives the eviction
  - POST /session/restore reads the cookie and returns what /oauth/callback does (blob,
    access_token, user), so the client can store the blob again
  - detect an eviction: a localStorage marker ("this device has data") that is missing when the
    app opens, and /session/restore answers yes. Then show "Safari cleared this device's data:
    restoring your setlists from Google Drive" and run the existing first-sign-in sync
    (checkFirstTimeAuth renames the Personal space to the Google name, Sync joins the existing
    same-named Drive folder). No tap needed. If /session/restore says no (no cookie), fall back
    to asking the user to sign in again: google-auth.ts uses access_type: 'offline' with
    prompt: 'consent', so that should be issued a new refresh token (verify with a real wipe)
  - update src/privacy.html in the same change: it says Chordless uses no cookies and the
    worker stores nothing. Say it sets one sign-in cookie (the encrypted token, HttpOnly, how
    long it lasts, removed on sign-out and Clear Local Data)
  - needs the network, so say so plainly at church
  - it is an auth change: review it with the user before building
  - security: a same-origin check (Origin / Sec-Fetch-Site) on /session/*; no
    Access-Control-Allow-Credentials with a reflected origin; restrict the current
    `Access-Control-Allow-Origin: *` (already on the production list); "Clear Local Data" and
    sign-out must clear the cookie too, or they would restore what the user wiped; check that
    chordless.app is not a CNAME to another registrable domain
  - tests: worker unit tests for set, restore and clear; a Playwright test that wipes
    IndexedDB and localStorage with the cookie kept and sees the restore
- either way, unsynced changes and device settings (theme, pad set) are lost: sync early and
  often (see the background sync item)
