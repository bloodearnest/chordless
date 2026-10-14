# Live mode

**Status: design only. Nothing here is built yet.**

Live mode is an explicit "we are performing from this setlist" state. While it is on, the
app uses the whole screen and keeps it lit. It is the place for anything that should happen
for the length of a service or rehearsal, not for the length of one page view.

## Why

Today the screen is kept awake because a setlist view is open: `SetlistView` and `ShareView`
each call `wakeLock.hold()` and `letGo()` (see `js/wake-lock.ts`). That ties a performance
setting to a route, and it breaks down when:

- the player switches to another app and comes back, or browses the library to find a song
  mid-service: the "performance" has not ended, but the route has changed;
- we want other things to follow the same switch: fullscreen now, and maybe synchronising
  songs between instances over WebRTC later.

## What the web platform allows

- **Wake lock** needs no permission. The browser drops it when the page is hidden, so it is
  asked for again when the page is visible.
- **Fullscreen** (`requestFullscreen()`) needs a user gesture every time, is not remembered
  between launches, and is usually left when the user switches apps. iPhone Safari only
  supports it for `<video>`; iPad, Android and desktop support it for any element.
- **Manifest `display`** applies to the whole installed app and can't vary by view.
  `display_override: ["fullscreen", "standalone"]` would hide the status bar on Android only,
  for every page. We don't use it: live mode asks for fullscreen from the page instead, which
  covers Android, iPad and desktop, and only while live.
- **Do Not Disturb** can't be switched on from a page. The most we can do is document the
  iOS Shortcuts / Android routines recipe for "when Chordless opens".

## The model

### State

One record, per device:

```ts
type LiveState = { route: Route; startedAt: number }
```

- It is kept in `localStorage`, next to the other preferences, and survives reloads and
  switching apps. A `storage` event (or `BroadcastChannel`) keeps two windows of one browser
  in agreement.
- **One live setlist at a time; the last one wins.** Going live on another setlist overwrites
  the record.
- It stores a *route* (`/setlist/<id>`, or a share's URL), not a setlist id, because a shared
  setlist is not in the library. See [SHARING.md](SHARING.md).
- It is not synced through Drive. It describes this device. (Cross-device sync is the WebRTC
  idea below, and would be separate.)

### Entering and leaving

- The overview page has a **Go live** button. On the live setlist it reads **Live now**; on
  any other setlist it offers to take over.
- The user leaves explicitly (**Leave live**). Nothing ends it for them: not a route change,
  not switching apps, not edit mode, not an idle timeout.
- While live, the shell shows a small indicator ("Live: Sunday AM") that links back to the
  setlist and holds the **Leave** action, so a stale live state can't go unnoticed.

### Services

Live mode is a small module that holds the state and sends an event when it changes.
Features register as *services* with a `start()` and `stop()`, and check their own
preference. It is not a plugin framework: a short list, wired by hand.

| Service | Needs a gesture | Notes |
| --- | --- | --- |
| Wake lock | no | Re-acquired when the page is visible (`visibilitychange`). |
| Fullscreen | yes | Wanted but not active (after switching apps, or Esc) is re-requested on the next tap, key or swipe, once per entry: if the user left it themselves, don't fight them. Hidden where `document.fullscreenEnabled` is false. |
| Sync (future) | no | WebRTC link between instances. Probably wants its own settings (a session, leader or follower). |

Services run while live **and** the page is visible, on every page, not just the live
setlist: searching the library mid-service shouldn't drop fullscreen or let the screen sleep.

The controller handles `visibilitychange` and the first-gesture hook once; a service says
whether it needs a gesture, rather than attaching its own listeners.

### Idle expiry

The wake lock's existing idle limit (`keepAwakeLimitMs`, default an hour; unlimited on mains
power where the Battery Status API says so) moves up into live mode, and applies to all
services:

- after the limit with no touch, key press or scroll, the services **let go** (the screen may
  sleep, fullscreen is dropped);
- the live state is **kept**. The next touch starts the services again, as the wake lock's
  `expired` state does now;
- so a tablet left on a stand overnight goes dark, and comes back when someone picks it up.

### Edit mode

Edit mode stays fully available while live. Fixes mid-performance (a wrong capo, a late song)
are exactly what it is for, and the edit/live split already protects against accidental
destructive changes. No blocking, no warning.

### Preferences

In the existing wake lock section, which becomes "Live mode":

- Keep the screen awake while live (today's toggle).
- Fullscreen while live (new; shown only where fullscreen is supported).
- The idle limit (today's "Keep awake limit").

"Keep awake now" goes: **Go live** replaces it.

## Changes to the code

- A `live` module (state, events, expiry), replacing the holder counting in `WakeLockController`
  (`hold()` / `letGo()`, `setManual()`). The controller keeps the Screen Wake Lock handling
  (acquire, release, visibility) and the battery check, as a service.
- `SetlistView` and `ShareView` stop calling `wakeLock.hold()` and `letGo()`.
- `ShareView` and `SetlistView` both repeat the `SetlistPage` lifecycle (`new SetlistPage`,
  `start`, `routeChanged`, `dispose`, `captureViewState`). `ShareView` only differs in its
  source (`openShare`), `readOnly: true`, `routeFor`, and its error and banner states. Move the
  repeated lifecycle into a shared helper in the same change.
- A fullscreen service, the overview button, the shell indicator, and the preferences.
- `app-preferences.ts`: the wake lock status and "Ask again" UI becomes live mode status.

## Open questions

- Which route a share's live record holds (the `/share/...` URL with its key fragment), and
  what happens when the share expires while live.
- Whether going live should also be reachable from somewhere other than the overview.
- What the shell indicator looks like in a song, where the whole screen is the song.
- What Sync needs from the live record (session id, role) before it is designed.
