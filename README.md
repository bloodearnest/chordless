# Chordless

Chordless is a web app for running a worship band's setlist: the lyrics and chords
for each song, laid out to be read from a music stand or an iPad, and controlled
with one touch while you're playing.

It is built for live use. Everything you'd want to do mid-song (change song, scroll,
hide the chords on a verse you know) is a swipe or a tap. Everything that could go
wrong on stage (deleting a song, changing a key) is behind an explicit edit mode.

## What it does

- **Setlists** of songs, in order, for a date. Songs are plain
  [ChordPro](https://www.chordpro.org/) files, and can be imported from SongSelect.
- **One-touch control:** left/right changes song, up/down scrolls.
- **Sections:** show or hide chords, or whole sections, separately for each verse or
  chorus, so the page shows only what the band needs.
- **Transpose** into any key, and set a capo, per song.
- **Smart layout:** text is sized to make the most of the screen.
- **Pads and click:** a media player for pad sounds (your own pad set, uploaded to your Drive; the app ships none) and a metronome.
- **Live and edit modes:** live mode is minimal and hard to break. Edit mode is where
  you reorder, delete, and correct songs.
- **Works offline.** Once loaded, Chordless doesn't need the internet, so a flaky
  church wifi can't stop the service.
- **Sync between devices** through the team's own Google Drive.

## Your songs stay yours

Song lyrics and chords are copyrighted, so Chordless never hosts them. They live on
your devices and in your own Google Drive folder, which you can share with your
worship team. Churches are expected to hold a CCLI licence. See
[docs/SHARING.md](docs/SHARING.md) for the thinking behind this.

## How it's built

Chordless is deliberately plain: vanilla JavaScript modules and
[Lit](https://lit.dev/) web components, with [Vite](https://vite.dev/) serving them in
development (no build step there) and bundling them for production. It's an offline-first
PWA: a service worker precaches the whole app, and data is kept in IndexedDB. A small Cloudflare Worker serves the files and
handles Google sign-in. It targets recent browsers (iOS and Safari 17, Chrome and Edge 120: see `.browserslistrc`), and
uses native browser features wherever it can.

## Documentation

- [DEVELOPERS.md](DEVELOPERS.md): running it locally, and the checks to run before a commit
- [docs/TESTING.md](docs/TESTING.md): how the tests are organised and written
- [docs/BUILD.md](docs/BUILD.md): the Vite build, the service worker and its precache, deploying
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md): songs, setlists and spaces
- [docs/SYNC_ARCHITECTURE.md](docs/SYNC_ARCHITECTURE.md): Google Drive sync
- [docs/SHARING.md](docs/SHARING.md): sharing and licensing
