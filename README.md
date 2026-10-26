# Chordless

Chordless is a web app for running a worship band's setlist: the lyrics and chords
for each song, laid out to be read from a device like a phone or tablet, prepared
and shared in advance, and controlled with one touch while you're playing.

It is built for live use. Everything you'd want to do mid-song (change song, scroll,
hide the chords on a verse you know) is a swipe or a tap. Everything that could go
wrong on stage (deleting a song, reordering the set) is behind an explicit edit mode,
and nothing is ever *forbidden*: a late song or a last-minute key change is always
possible.

## Who made it

Chordless is designed and built by an experienced software engineer who is also
an experienced church worship leader, so it is shaped by what is actually needed
week to week. It is built with the help of AI coding assistants (Claude Code,
mostly): they write a great deal of the code, but under human direction and
review, and the design, the priorities and the decisions are the author's.

The tests, the docs and the checks in CI are what keep that honest. There are
3500+ automated tests, and they run on Linux, macOS and Windows on every
change.

## Why Chordless?

Existing apps didn't meet the needs of the author and his worship team: patchy
cross platform support, awkward patterns for live use, poor use of screen space,
lack of shared song libraries, and little help with prep, planning and keeping
track of what was played.

Chordless has a few high level design goals that drive its features, listed
below. Most are already implemented. Some are planned, and marked as such.

### Making the most of your digital screen

We're still copying printed paper layouts onto screens, which wastes space.
Chordless embraces the fact that it's a digital screen, and tries UI patterns
that make use of it.

- **Smart layout:** the text is sized to be as large as the screen allows, in as many
  columns as fit, so you can read it from further back, on any size of device.
- **Show and hide, per section:** hide the chords on the chorus, because you
  know them. Or hide the whole chorus, because you know the lyrics too. But you
  really need that 3rd verse! Each section is separate, so the page shows
  only what you need. That saves space and means less poking at your device
  mid song. For most songs on a tablet, it removes any need to scroll during
  a song.
- **Light and dark themes**. Table stakes, but also important so your device
  does not cause glare on stage.

### Built for live use

Apps used at live events need to be reliable and avoid disasters.

- **Stays awake** while you're live, so the screen doesn't dim mid-song.
- **One-touch control:** left/right changes song, up/down scrolls. Keyboard, touch and
  foot pedals that send arrow keys all work.
- **Edit mode for changes** cuts the chance of an accidental change while live.
  But changes are still possible when you need them.
- **Live mode** syncs with other people on the same setlist, so everyone keeps up
  with live changes, in a service or in rehearsal.
- **Modal UI patterns** for most things, so you don't have to navigate away from
  the current song.
- **Fully offline capable.** All data is stored on your device, and synced when
  you have internet.

### Customisable to the musician

We're all special in our own way.

- **Singer?** Only show lyrics by default.
- **Guitarist?** Enable capo controls, separately from transpose.
- **Not a concert pitch instrument?** Set a standard transpose applied to every
  song. *Coming soon, use capo for now!*
- **I know this song backwards!** Even the 3rd verse? Hide the sections you
  don't need to spend screen space on.
- **Make notes** to remind you of key information. These can be personal, or
  shared with the team. *Sharing coming soon.*
- **Personal sync.** Use multiple devices, and your data and preferences sync
  between them. *Preferences sync coming soon.*

### Setlist creation

You know, the basics.

- **Add songs** from your library, or import from SongSelect or other ChordPro.
  Have variant versions of songs with alternate chords or lyrics.
- **Find songs fast.** Search by title, artist or any line of the lyrics. It
  finds other forms of a word ("praises" finds "praise"), poetic spellings
  ("ev'ry" is "every"), words in any order, and copes with a slip of the
  fingers. It keeps up as you type, puts the best match first and marks the
  words it found.
- **Transpose** to your preferred key.
- **Order songs** as you like.
- **Add notes** to share with your team. *Coming soon.*
- **Define song structure.** How many times are we doing the bridge? Or: we're
  only doing the chorus of this song. *Coming soon.*
- **Setlist metadata.** Date, time, leader, service type.
- **See song history.** When did we last do this song?
- **Track prepared vs played.** We often prepare more songs than we play. Tools
  to track what you *actually* played, rather than what you prepared, to help
  with planning. *Coming soon.*

### Built for teams

- **Create a Worship Team.** Invite people to join, as worship leader or team
  member. Backed by your Google Drive. *Other storage is possible in future.*
- **Shared songs.** A synchronised song database for the team, so everyone is
  singing from the same literal hymn sheet.
- **Shared setlists.** All current and past setlists, available to everyone.
- **Share with guests.** Anonymously and temporarily share a setlist with
  anyone, even outside your team.

### Built in media player

Use it for home practice, team rehearsal, or live.

- **Metronome.** Plays at the song's BPM and time signature.
- **Tonic pads.** Upload your pad sounds and play the tonic. Fades and
  transitions between songs.

### Accessibility

- **Any device with a browser:** phones, tablets and laptops, iOS, Android, Windows, macOS,
  Linux and ChromeOS. There's nothing to install from an app store (though you can add it to
  your home screen and it behaves like an app).
- **Older hardware is a goal, not an afterthought.** Churches don't replace their iPads every
  two years. Chordless runs on devices up to about five years old (iOS and iPadOS 17,
  Chrome and Edge 120), which can all update to that for free.
- **Colour highlights.** Highlight chord background/text colours to help with
  visual impairment or dyslexia. *Coming soon.*

### Your songs stay yours

Song lyrics and chords are copyrighted, so Chordless never hosts them. They live on
your devices and in your own Google Drive folder, which you can share with your
worship team. The server only passes access along; it keeps no charts, lyrics or pad audio.
Churches are expected to hold a CCLI licence. See [docs/SHARING.md](docs/SHARING.md) and
[docs/SPACES.md](docs/SPACES.md) for the thinking behind this.

## How it's built

Chordless is deliberately plain: TypeScript modules and [Lit](https://lit.dev/) web
components, no framework on top, and native browser features wherever possible.

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
