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
- A message the person sees with a value in a different place in a different language is one message
  with the value in it, not two fragments joined in code.

## Changing a message

By hand in the file, or in the running app (`just serve`, dev only):

- **Alt + right click** on a message, or on a tooltip, label or placeholder it is in, opens it with its
  comment and the values it has. Save rewrites `src/text/en.ts` (that message only: the diff is its
  lines) and the page takes the new words without reloading, so a toast or a dialog stays where it is.
  Two messages that say the same words are both offered.
- **`/dev/copy.html`** lists every message to change, including the ones that are hard to cause (a
  failure of a save).
- **`?copy=keys`** on any address shows the name of each message in place of its words.

The editor is a Vite plugin (`vite-plugins/copy-editor.ts`) and `js/copy-editor.ts`, put on the pages
by the dev server and in no built file. It writes a file of the repository, so it answers only to a
request that carries its own header and that reached the server as `localhost`: not by the Tailscale
name the dev server can also be reached by.

## Checks

`tests/text.node.test.ts` fails when the file is not valid Fluent, when `t('name')` names a message
that is not there, and when a message is there that nothing uses.

## What is not in it yet

The migration is by area. Done: the toasts (`toast(...)` and the buttons on them), and the message
about a lost Drive folder. Still in the code: dialogs, confirmations, empty states, labels, the Help
page (`js/help-content.ts`), the text `describeSetlistChange` makes, and the Worker's emails.
Text with a link or bold in it needs a markup convention that is not built; say so when you reach one
rather than splitting the sentence.

New messages go in the catalogue, not in a template. Keep what only the developer needs (an error's
text, a version number) in a toast's `details` or the console, not in the message.
