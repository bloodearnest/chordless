# Chordless

Chordless is a web app for running a worship band's setlist: the lyrics and chords
for each song, laid out to be read from a music stand, a phone or an iPad, and controlled
with one touch while you're playing.

It is built for live use. Everything you'd want to do mid-song (change song, scroll,
hide the chords on a verse you know) is a swipe or a tap. Everything that could go
wrong on stage (deleting a song, reordering the set) is behind an explicit edit mode,
and nothing is ever *forbidden*: a late song or a last-minute key change is always
possible.

## Who made it

Chordless is designed and built by an experienced software engineer who is also a church
worship leader, so it's shaped by what actually goes wrong on a Sunday morning. It is built
with the help of AI coding assistants (Claude Code, mostly): they write a great deal of the
code, under human direction and review, and the design, the priorities and the decisions are
the author's. The tests, the docs and the checks in CI are what keep that honest.

## Making the most of your screen

- **Smart layout:** the text is sized to be as large as the screen allows, in as many
  columns as fit, so you can read it from further back, on any size of device.
- **Show and hide, per section:** hide the chords on a verse everyone knows, or hide a whole
  verse or chorus you're skipping this week. Each section is separate, so the page shows
  only what the band needs, and nothing is lost: bring it back with a tap.
- **Light and dark themes**, with the text size and colours kept in step.
- **Stays awake** while you're live, so the screen doesn't dim mid-song.

## Playing, not fiddling

- **One-touch control:** left/right changes song, up/down scrolls. Keyboard, touch and
  foot pedals that send arrow keys all work.
- **Transpose** into any key, and set a capo, per song, for the singer or the instrument.
- **Pads and click:** a media player for pad sounds (your own pad set, kept in your Drive;
  the app ships none) and a metronome.
- **Notes** on a song, for the things that aren't in the chart.
- **Live and edit modes:** live mode is minimal and hard to break. Edit mode is where you
  reorder, delete and correct.

## Your setlist, your way

- **Setlists** of songs, in order, for a date. Songs are plain
  [ChordPro](https://www.chordpro.org/) files, so they're yours to take anywhere.
- **Bring songs in** from SongSelect, from files, or by forwarding the leader's setlist email.
- **Share a setlist** as a link with anyone, no account needed. Links expire.
- **Teams:** share a space with the band, with a worship leader and team members, each with
  their own role.

## Works everywhere, including older devices

- **Any device with a browser:** phones, tablets and laptops, iOS, Android, Windows, macOS,
  Linux and ChromeOS. There's nothing to install from an app store (though you can add it to
  your home screen and it behaves like an app).
- **Older hardware is a goal, not an afterthought.** Churches don't replace their iPads every
  two years. Chordless runs on devices up to about five years old (iOS and iPadOS 17,
  Chrome and Edge 120), which can all update to that for free.
- **Works offline.** Once loaded, Chordless doesn't need the internet, so a flaky church
  wifi can't stop the service. Changes made offline sync when you're back online.
- **Sync between devices** through your own Google Drive.

## Your songs stay yours

Song lyrics and chords are copyrighted, so Chordless never hosts them. They live on
your devices and in your own Google Drive folder, which you can share with your
worship team. The server only passes access along; it keeps no charts, lyrics or pad audio.
Churches are expected to hold a CCLI licence. See [docs/SHARING.md](docs/SHARING.md) and
[docs/SPACES.md](docs/SPACES.md) for the thinking behind this.

## How it's built

Chordless is deliberately plain: TypeScript modules and [Lit](https://lit.dev/) web
components, with no framework on top, using native browser features wherever it can.

- **Offline-first PWA:** a service worker precaches the whole app, and data is kept in
  IndexedDB. Pages have real URLs and survive a reload.
- **[Vite](https://vite.dev/)** serves the modules as they are in development (no build step
  there) and bundles them for production. The types are erasable syntax only, so Node can run
  the same files.
- **Cloudflare Worker:** serves the files, handles Google sign-in, and runs the team and
  share-link services. It streams traffic through and stores no song content. Infrastructure
  that rarely changes is Terraform in [`infra/`](infra/README.md); deploys are wrangler's.
- **Google Drive** is the remote storage, behind a storage interface that other backends can
  implement.
- **Tested at three levels** (Node, browser unit tests, Playwright end to end), with CI,
  linting, type checks and a dependency audit on every pull request. Changes reach `main`
  only through reviewed pull requests.

## Documentation

- [DEVELOPERS.md](DEVELOPERS.md): running it locally, and the checks to run before a commit
- [docs/TESTING.md](docs/TESTING.md): how the tests are organised and written
- [docs/CI.md](docs/CI.md): the checks CI runs and how changes are merged
- [docs/BUILD.md](docs/BUILD.md): the Vite build, the service worker and its precache, deploying
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md): songs, setlists and spaces
- [docs/SPACES.md](docs/SPACES.md): personal and team spaces, roles
- [docs/SYNC_ARCHITECTURE.md](docs/SYNC_ARCHITECTURE.md): Google Drive sync
- [docs/SHARING.md](docs/SHARING.md): share links and licensing
