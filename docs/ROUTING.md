# Routing

The app is a single page. `index.html` is a shell: a `#view-outlet` that the router fills
with the view for the URL, the menu (`<nav-menu>`) and the media player, which stay
while views come and go, so music carries on when you move around.

Every URL is served the shell (by the service worker, and by the worker's SPA fallback),
and `js/app.js` starts the router.

## Routes

URLs are paths; the router doesn't use `#hashes` (a lint rule forbids them).

| URL | Route | View |
| --- | --- | --- |
| `/` | `home` | `home-view.js` |
| `/songs`, `/songs?q=<search>`, `/songs/<uuid>` | `songs` | `library-view.js` |
| `/setlist/<id>`, `/setlist/<id>/song/<n>` | `setlist` (`songIndex` -1 is the overview) | `setlist-view.js` |
| `/storage`, `/preferences`, `/import-song`, `/import-setlist`, `/bookmarklet` | by name | `*-view.js` |
| anything else | `not-found` | `not-found-view.js` |

- `js/router.js` is pure: `matchRoute(url)`, `buildUrl(route)`, and `historyAction(from, to,
  state)`, which says whether a move pushes a history entry, replaces it, or goes back.
  Opening a song from a list or overview pushes; song to song replaces; song to the
  list goes back, if you came from it (the entry we pushed is marked `fromParent`).
- `js/app-router.js` is the runtime: it follows link clicks (including inside shadow DOM)
  and back/forward, loads a view *before* changing the URL (so a failed load can't leave
  the address bar pointing at nothing), swaps views in a view transition, sets the title,
  tells screen readers (an `aria-live` region), and sends a `RouteChangeEvent`.
- `js/views/registry.js` lists the views by route name; each loads its module when first
  shown. A test checks there is one for every route.
- The route is also a Lit context (`js/route-context.js`) for components that need it.

To move from code, use `goTo(url)` (`js/navigation.js`), not `location`. Links in markup
(`<a href="/songs">`) need nothing: the router follows them.

## Views

A view is a custom element extending `PageView` (`js/views/page-view.js`): light DOM, so
the stylesheet and ids apply; class `view`, so it lays out as a child of `.app-container`.

- The router sets `route` on the view, before it is attached and when the route changes
  *within* the view (another song of the same setlist). React in `willUpdate()`.
- The router removes the view when leaving it. **Undo what the view did outside itself**
  in `disconnectedCallback()`: listeners on `window`/`document`, observers, timers, classes
  on `<body>` (edit mode), and anything it put in the shell (the menu's song list).
  `SetlistPage.dispose()` and `LibraryView` are examples.
- Views own their scrolling: the page itself doesn't scroll.
- **Coming back to a view** with the back or forward button, it should look as it was left.
  What belongs in the URL goes there: the library's search is `/songs?q=...` (typing replaces
  the entry, after a short pause), so it survives reload, links and back with no extra code.
  What doesn't (scroll positions, which years are open) is view state: each history entry has a
  `key`; when a view is left, or the page is hidden, the router asks it for `captureViewState()`
  (something JSON can hold, or nothing) and keeps that against the entry, in memory and in
  `sessionStorage` (the latest 50 entries). When a view is made for that entry again, in
  response to back, forward or a reload, it gets the state as `restoredState`, set before it
  attaches like `route`. A new navigation is a new entry, so starts clean; moving between
  entries of the same view keeps the live view and restores nothing.
  `PageView` keeps the `<main>`'s scroll by default (`restoreScroll()` waits for what the
  view shows to be tall enough); the library keeps its list scroll, the home page the years
  that were opened, and a setlist how far each song was scrolled.

## The media player

`<media-player>` lives in the shell. It shows on setlists, and elsewhere only while
something is playing (`active` attribute, `isActive`). Leaving a setlist sends
`SongChangeEvent(null)`, which clears the *current* song but not the one playing.
Collapsed, it is a translucent pill of three buttons: play (the song in view), stop, and expand.

The player is optional: setlist navigation is the core, and the player may be off on an older
device. `js/media-player-loader.js` loads its code only if the device has Web Audio and the
player is on in Preferences (and when it is switched on later); a player that fails to load is
a warning, not an error; and Drive pads are only preloaded when the player and pads are on.
Don't let the setlists depend on it.

## Reloads

A few actions reload the page on purpose, because the database underneath every view is
replaced (resetting from Drive, clearing local data, and switching organisation) and to
take a new version of the app (the menu's "Update ready" item). Each
has a `biome-ignore lint/plugin` saying why. Anything else that needs to leave the page
is a bug: use `goTo()`.

## Adding a view

1. A `PageView` subclass in `js/views/`, registered with `customElements.define`.
2. An entry in `js/views/registry.js`, and the route in `js/router.js` if it is new.
3. Teardown for anything it does outside its own elements.
