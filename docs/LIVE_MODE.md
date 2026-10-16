# Live mode

**Status: built.** The state (`js/live.ts`), the wake lock following it, fullscreen
(`js/fullscreen.ts`), the Go live button in the setlist header and the Preferences toggle. Not yet tried on a real tablet.

Live mode is an explicit "we are performing from this setlist" state. It is the place for
anything that should last for the length of a service, not for the length of one page view.

Practice is not live. Someone working through a setlist wants the screen kept awake, but is not
performing: so the wake lock does not need live mode (below), and live mode adds to it.

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

### What is on when

| | Screen awake | Fullscreen |
| --- | --- | --- |
| A setlist (or share) is open | yes, if "Keep the screen awake" is on (the default) | no |
| Live | yes, **on every page**, if "Keep the screen awake" is on | yes, if "Fullscreen while live" is on (the default) |

So the screen is wanted when a setlist is open **or** the device is live. Live does not
override the preference: someone who turned keeping awake off (to spare the battery) gets
fullscreen only.

### State

One record, per device (`js/live.ts`):

```ts
interface LiveState { url: string; title: string; startedAt: number }
```

- It is kept in `localStorage`, next to the other preferences, and survives reloads and
  switching apps. A `storage` event keeps two windows of one browser in agreement; both send
  `LiveChangeEvent` on `window`.
- **One live setlist at a time; the last one wins.** Going live on another setlist overwrites
  the record.
- It stores a *URL* (`/setlist/<id>`, or `/s/<id>#<key>` for a share), not a setlist id,
  because a shared setlist is not in the library and its key is in the fragment. See
  [SHARING.md](SHARING.md). `title` is the setlist's name, to say what is live.
- It is not synced through Drive. It describes this device. (Cross-device sync is the WebRTC
  idea below, and would be separate.)

### Entering and leaving

- The setlist's header has a round **Go live** button (a broadcast icon, next to share), on the
  overview, for a setlist or a share. Pressing it is the gesture fullscreen needs. It is quiet
  when off and red when this setlist is live, where pressing it leaves live; when another
  setlist is live it offers to take over.
- The user leaves explicitly (**Leave live**). Nothing ends it for them: not a route change,
  not switching apps, not edit mode, not an idle timeout.
- The header button is the indicator: red while this setlist is live. There is no other one
  (a footer chip that showed on every page was tried and dropped: the header makes it obvious).
  So live is left from the live setlist's overview.

### Services

Live mode starts and stops what should happen for its length. It is not a plugin framework: a
short list, wired by hand.

| Service | Needs a gesture | Notes |
| --- | --- | --- |
| Wake lock, on every page | no | The existing `WakeLockController`: the lock is wanted when a setlist is open or live. Re-acquired when the page is visible (`visibilitychange`). |
| Fullscreen | yes | Wanted but not active (after switching apps, or Esc) is re-requested on the next tap, key or swipe, once per entry: if the user left it themselves, don't fight them. Hidden where `document.fullscreenEnabled` is false. |
| Sync (future) | no | WebRTC link between instances. Probably wants its own settings (a session, leader or follower). |

Services run while live **and** the page is visible, on every page, not just the live
setlist: searching the library mid-service shouldn't drop fullscreen or let the screen sleep.

### Idle expiry

The wake lock's idle limit (`keepAwakeLimitMs`, default an hour; unlimited on mains power where
the Battery Status API says so) stays where it is and applies to the lock whether it is wanted
by an open setlist or by live mode. After the limit with no touch, key press or scroll the lock
is let go (state `expired`) and the next touch takes it again. The live state is kept: a tablet
left on a stand overnight goes dark, and is still live when someone picks it up. Fullscreen has
no timer.

### Edit mode

Edit mode stays fully available while live. Fixes mid-performance (a wrong capo, a late song)
are exactly what it is for, and the edit/live split already protects against accidental
destructive changes. No blocking, no warning. Live mode never takes an option away (Add Song is
on the overview in or out of edit mode): see "be permissive in the moment" in
[UI_DESIGN.md](UI_DESIGN.md).

### Preferences

In the existing wake lock section, which becomes "Screen and live mode":

- Keep the screen awake (today's toggle; while a setlist is open, and while live).
- Fullscreen while live (new, **on by default**; shown only where fullscreen is supported).
- The idle limit (today's "Keep awake limit").

"Keep awake now" goes: **Go live** replaces it.

## Changes to the code

- `js/live.ts`: the state and events.
- `WakeLockController`: `setManual()` is gone; `#wanted()` also asks whether the device is live
  (and a page opened while live takes the lock at once). `hold()` and `letGo()` stay, for the
  open setlist.
- `js/fullscreen.ts`: asked for in the tap that goes live (the header button's handler runs
  synchronously, so the browser sees the gesture), again on the next gesture after a refusal or
  coming back to the page, never after the user left it themselves. Started from `app.ts`.
- The button (`#live-button`) is in `setlistTemplate`, with the share button; `SetlistPage`
  shows it on the overview only, does the going and leaving, and keeps its look and label
  (`aria-pressed`, red when live) current.
- `app-preferences.ts`: the "Screen and live mode" panel has the Fullscreen while live toggle;
  "Keep awake now" is gone.
- `SetlistView` and `ShareView` share `SetlistPageHost` (built), so the setlist lifecycle is
  in one place.

## Open questions

- **Fullscreen on a ChromeOS tablet with two apps side by side** (Chordless and a pedals app):
  does the request keep the split, or take over the screen? Not known; it is on by default so
  it can be tried, and can be turned off in Preferences.
- What happens when a share expires while live (the plan: a toast, and leave live).
- Whether going live should also be reachable from a song (the header there is crowded).
- Nothing shows that the device is live on other pages (the library, Preferences), so a stale
  live state could go unnoticed there until the setlist's overview is opened. If that matters,
  something small is needed there.
- What Sync needs from the live record (session id, role) before it is designed.
