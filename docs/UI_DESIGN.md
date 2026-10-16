Goals

1. Live application

- should be hard to make mistakes (e.g accidentally deleting)
  - willing to trade off additional UX clicks to enable this
- should be possible to change things without stopping live/playack state
  - e.g. display preferences, song sections visibility, sounds, tempo, key
  - preferences should be a modal that doesn't reload or change page
  - some things are so core (e.g. authentication, choosing band) that they should probably force a reload
  - probably want an explicit live mode to enable this

2. webapp not website

3. Messages

- a failure the page has no place for (a save that did not work) is a toast: `toast()` in
  `src/js/toast.ts`, shown by `<app-toast>`. Never `alert()`: it stops everything, and a live
  setlist must not stop
- one at a time, along the bottom (clear of the lyrics at the top and the header), centred
- an error stays until dismissed, with the reason behind "Details" and, where trying again is
  safe, a "Try again" button; anything else goes by itself after five seconds
- it takes no focus, so the arrow keys and swipes carry on moving through the setlist
- behind a modal dialog (which makes the rest of the page inert) it can be seen but not pressed
  until the dialog is closed
