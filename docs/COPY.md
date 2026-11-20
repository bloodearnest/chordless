# What the app says

Everything the app says to a person (a toast, a dialog, an empty page, a button) lives in one file,
`src/text/en.ts`, apart from the code that shows it. The code asks for a message by name; the words
can be changed without reading any code.

```ts
toast(t('toast-setlist-moved', { title, space: target.name }), { ... })
```

```fluent
# { $title } is the setlist, { $space } the space it went to.
toast-setlist-moved = Moved { $title } to { $space }.
```

## The file

It is [Fluent](https://projectfluent.org/fluent/guide/), in a template literal (`String.raw`) so that
Vite, the tests and Node all load it as the module it is. That means a message cannot have a backtick
or `${` in it. `{ $name }` puts a value in; a selector does plurals:

```fluent
songs-count = { $count ->
    [one] { $count } song
   *[other] { $count } songs
}
```

- **Names** are lowercase with hyphens, area first: `toast-…`, `action-…` (the buttons on a message),
  `folder-gone-…`. A name is never built in code (`t('toast-' + x)` is not found by the test below);
  pass the whole name.
- **Write a comment** above a message: when it is shown, and what each `{ $value }` is. The editor
  shows it, and it is what lets someone reword a message without reading the code.
- **Terms** (`-folder-gone-safe`) are text several messages share.
- **A message is a whole sentence, or the sentences that go together.** Never a fragment that code
  joins to another in the middle of a sentence (the order of words differs between languages, and a
  writer cannot see the whole). Where whole sentences come and go (the question to delete a space has
  one more sentence when it is a Team the person is a member of), one message for each, joined with a space in code;
  where a clause does (", and its file goes to the Drive trash"), the message in its two forms.
  A number in a sentence, singular or plural, is a selector in the message.

## A link or emphasis in a sentence

A message marks the words with a tag, `<name>words</name>`, and the code says what each tag is
(`js/rich-text.ts`):

```fluent
space-drive-not-connected = Google Drive is not connected. <connect>Connect it</connect> on the Account page.
```

```ts
html`<p>${rich('space-drive-not-connected', undefined, {
  connect: words => html`<a href="/account">${words}</a>`,
})}</p>`
```

One level only (no tag inside a tag), and only the names the code gives are tags; any other `<…>` is
shown as it is, and so is anything in a value given to the message (a Team called `<b>`). In the dev
editor the message is edited with its tags in it.

## Errors

An error has two possible readers, and says what it says for one of them.

- **A message written for the person** is a `UserError` (`js/utils/errors.ts`) made from a message of the
  catalogue: `throw new UserError(t('pads-no-name'))`. "Please provide a pad set name." is for them, and
  shown as it is. The Worker's refusal of a request (a `TeamError` with a 4xx status: "This invite is not
  valid") is one too, in the Worker's own words.
- **Any other error is for a developer** ("Upload error: 403", "The share key is the wrong length", a
  failure of the Worker's own, Google's `access_denied`). Where a page has no place for it, say what could
  not be done in words, from the catalogue, and keep the error itself for the console and the reports:
  `this._error = whatToSay(error, t('licence-save-failed'))`. A toast does the same with the error behind
  "Details" (`details: errorMessage(error)`).

Where a message carries the reason after what failed ("Signing in failed: { $reason }"), it has two forms,
and `failedWith(error, t('x-failed', { reason }), t('x-failed-plain'))` picks the one with the reason only
for an error written for the person ("Signing in failed.") otherwise.

So a person is never given text only a developer can use, and one who is given a reason is given it in
words that are theirs to edit. Do not decide what to do by what an error's text says (`message.includes(…)`):
check its type.

## Changing a message

By hand in the file, or in the running app (`just serve`, dev only):

- **Alt + right click** on a message, or on a tooltip, label or placeholder it is in, opens it with its
  comment and the values it has. Save rewrites `src/text/en.ts` (that message only: the diff is its
  lines) and the page takes the new words without reloading, so a toast or a dialog stays where it is.
  Two messages that say the same words are both offered. The dev server also sends a rewrite of the
  file made by hand, so a page that is open takes that too.
- **`/dev/copy.html`** lists every message to change, including the ones that are hard to cause (a
  failure of a save).
- **`?copy=keys`** on any address shows the name of each message in place of its words.

Nothing of the app's own modules is Vite's (no `import.meta.hot`): the dev service worker has
nothing cached ahead, and would fail to start the app offline on the Vite client it would need.

The editor is a Vite plugin (`vite-plugins/copy-editor.ts`) and `js/copy-editor.ts`, put on the pages
by the dev server and in no built file. It writes a file of the repository, so it answers only to a
request that carries its own header and that reached the server as `localhost`: not by the Tailscale
name the dev server can also be reached by.

## Checks

`tests/text.node.test.ts` fails when the file is not valid Fluent, when a name is in it twice (Fluent keeps the first and logs an error on every page for the rest), when `t('name')` names a message
that is not there, and when a message is there that nothing uses.

## What is not in it yet

The migration is by area. Done: the toasts (`toast(...)` and the buttons on them), the message
about a lost Drive folder, and the questions asked before something is changed (the confirmation
dialogs, and `app-modal`'s own Confirm and Cancel), what the pages say while they load, when they have
nothing to show and when they could not (`status-…`), the signed-out card, and the lead sheet and pad
messages. The Help page (`help-<page>-<section>-<item>-…`: the shape and the pictures stay in
`js/help-content.ts`, and each page there is a function, so an edit shows the next time it is opened), the
Account and Teams page and a space's page (the cards, the manager, the Drive panel, storage), and
what a role is called (`role-…`) and how long ago a sync was (`sync-time-…`), Preferences (what you play, instrument
pitch, tuning, chords, screen, the highlight colour, fonts, theme and text size), About, the menu and the media
player's settings, and the first time (the first-use questions, the welcome card, and why to install), and importing songs (the page, the SongSelect bookmarklet and its help, and what is said of each song's melody range, and the choices when a song is already in the library), the header, the key, capo, instrument and tuning pickers, a song's settings and the media player, a setlist's details and a song's (the forms and dialogs, and how long ago something was), teams and spaces (the whole of the join page, a space's people and page, the tabs, and the library's filter), sharing and contact (sharing a setlist by link or as a list of songs, and what is sent with each; the invitation message to a Team; Contact; the usage reports; uploading pad sounds), songs and charts (a song's versions and the question to delete one, a song on a card, annotations, and the buttons that show what a section holds), the pages (their headings, the titles of the browser's tabs, the links at the bottom, the shared setlist's notes), making a Team (the wizard, inviting people, its CCLI licence number and where its files are reached from), deleting a Team or space everywhere, exporting and importing a space, and importing a setlist from an email (what the review says, the leader matching, the changes to an existing setlist; the warning about a doubtful date is made in `js/email-setlist.ts` and still in code). Where a list of options has its words in a module (`PLAYS`, `PITCHES`, `TUNINGS`,
`FONT_CHOICES`, `TINT_PRESETS`), each `label` is a getter that asks for its message, so that an edit in the
dev editor shows at once. Errors follow the policy above in the places that print them whole (the Team wizard, the panels of a
Team, the Drive sync panel, the pad sets, the export panel), and the last odd sentences (the live button, who an
annotation is shared with, the leader's email checks, the Google sign-in and folder picker errors) are in the catalogue.
Still in the code, on purpose: the sync's progress messages (`js/sync/`, the engine's own log), the text
`describeSetlistChange` makes, the SongSelect bookmarklet (it runs in SongSelect's page), errors only a developer reads,
the support details in Contact, and the Worker's emails.

New messages go in the catalogue, not in a template. Keep what only the developer needs (an error's
text, a version number) in a toast's `details` or the console, not in the message.
