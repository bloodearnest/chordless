# Project: chordless

## Overview

This is a webapp for arranging a setlist of worship songs for church, showing the lyrics and chords for them.

The songs are input as chordpro files

Its key features:

- hide or show chords separately on each stanza
- hide or show each stanza separately
- transpose key
- one touch control (left/right -> change song, up/down -> scroll current song
- songs can be reordered
- smart layout/zoom to maximise the text size.
- works offline

Extra features I would like to add

- quick way to add notes (e.g. "repeat this 4 times", "drop out here", etc)
- quick edit feature for quick song corrections

## UI

We will use an edit mode paradigm. That is, in normal or "live" mode, then
theres now way to make destructive changes. e.g. delete songs, or change keys.
To do that, you have to enter edit mode explicitly. This has several goals

- prevent mistakes in a live performance setting that could be disasterous
- common UI pattern for the app
- edit mode UI can be more complex/cluttered, and the normal mode is simple and minimal, to maximise information.

### Pragmatic, not dogmatic: be permissive in the moment

Edit mode guards against *accidents*; it is not a rule about what users may do. People use the app
in ways we can't all model, and they are grown-ups: if they want to make a change, even mid-service,
they must be able to. Overly restrictive is an antipattern here.

- Don't remove an option because it "doesn't belong" in a mode. A late song, a key change, a
  fix to a chart: all must stay possible while live. Adding a song is always available, not
  behind edit mode.
- Protect with friction, not prohibition: a confirmation, a second tap, an undo, or edit mode for
  the risky or destructive things (delete, reorder). Never a dead end.
- Edit mode is for editing the setlist's contents (order, keys, and later BPM), not a gate in
  front of every change.
- Features that depend on how a group works (a leader pushing changes over a live session,
  `docs/LIVE_SYNC.md`) are opt-in: they add to what a lone user can do and never take it away.
- Read-only (a reader of the Drive folder, or someone with a share link) should only stop writing
  back to sync, never local edits: a last-minute key change must work for them too. (Built for a
  reader of the Drive folder; a received share's page is still read-only, see the TODO.)

### Live use and messages

- Things must be changeable without stopping live/playback state (display preferences, section
  visibility, sounds, tempo, key): preferences are a modal that doesn't reload or change page. Only
  things so core that they should force a reload (authentication, choosing a space) may.
- It is a webapp, not a website.
- A failure the page has no place for (a save that did not work) is a toast: `toast()` in
  `src/js/toast.ts`, shown by `<app-toast>`. Never `alert()`: it stops everything, and a live
  setlist must not stop. One at a time, along the bottom (clear of the lyrics and the header),
  centred. An error stays until dismissed, with the reason behind "Details" and, where trying again
  is safe, a "Try again" button; anything else goes by itself after five seconds (fifteen if it offers something, such as Undo). It takes no focus,
  so the arrow keys and swipes carry on moving through the setlist. Behind a modal dialog (which
  makes the rest of the page inert) it can be seen but not pressed until the dialog is closed.

## Spaces and copyright

**Chordless never stores copyrighted content; it only passes access on to it.** Charts, lyrics and pad
audio live in the user's own browser and in a Drive the user (or their team space's owner) controls.
The Worker passes team-space traffic through (streamed, never buffered to storage) without
persisting or caching it: no KV, R2, Durable Object or Cache API entry may hold song or pad
content. They hold only membership, roles, the owner's encrypted token blob, checksums, and, for
live sync, the latest *structure* of a live setlist (its songs' titles, order, keys, tempo and
notes: a setlist is not copyrighted, a chart is; `docs/LIVE_SYNC.md`), never chart text. (Share
links are the one exception: the Worker caches ciphertext it cannot read.) The space model (personal
and team spaces, roles, the Worker's team service) is in `docs/SPACES.md`. The word is **space** in the code and the docs;
in the UI people see **Personal** and **Team** (the list's heading is "Personal and Team Spaces"; "Create a new Team", "Account and Teams": the page that lists them is
designed in `docs/ACCOUNT.md`), and roles are called worship leader and team member. ("organisation" is the old name; it
survives only in names already stored on devices and in Drive.)

## Tech Stack

- we are using an offline first approach, with proper url navigation and page reload, handled by a service worker
- we are using newer css techniques to do the transition to avoid FOUC and other things.
- we are using lit for components
- we are using service worker
- we are using google auth and gdrive api for remote storage
- we are using cloudflare workers as out deployment, and wrangler locally

## Development Standards

- Use `just format lint test` to verify all changes (and `just ci` before a pull request: `docs/CI.md`). This runs formatting, linting (Biome, `tsc -b` over the tsconfig.*.json projects, knip for unused files, exports and dependencies, and a dry-run deploy of `wrangler.toml` that fails on warnings: `scripts/lint-wrangler.sh`), and all three test suites: node tests, browser unit tests (Web Test Runner) and Playwright tests.
- How the tests are organised, and how to write them: `docs/TESTING.md`. The interface between the sync engine and wherever files are kept (Drive now, the Worker's team service next): `docs/STORAGE_API.md`. How navigation works (the app is a single page): `docs/ROUTING.md`. Other design and architecture docs are in `docs/` too (`docs/SPACES.md` for spaces, `docs/SHARING.md` for share links, `docs/SYNC_ARCHITECTURE.md` for sync, `docs/ENVIRONMENTS.md` for dev and prod (two Google Cloud projects), `docs/CLOUD_MIGRATION.md` for the planned move to a new Google Cloud project, to be done before going live).
- TypeScript (erasable syntax only: no enums or parameter properties, so Node and esbuild can strip the types) and Lit, built and served with Vite (with `@cloudflare/vite-plugin`, which runs the Worker next to it). There is no build in dev: Vite serves the modules as they are. Production is `vite build`. Keep it that thin: no frameworks, no transpiling beyond what the browser floor needs. Dependencies are npm packages, imported by name and bundled by Vite
- Infrastructure that rarely changes is Terraform in `infra/` (`infra/README.md`): the Cloudflare zone side (Email Routing, the Worker's custom domain, DNS, TLS settings) and the Google Cloud project (APIs, API keys, service account). Deploys, and everything in `wrangler.toml`, stay wrangler's: do not move the Worker, its assets, bindings or secrets into Terraform. `gcloud` and `terraform` come from `mise.toml`
- The service worker is built as a classic script with the whole app precached (`vite-plugins/service-worker.ts`); see `docs/BUILD.md`
- Use modern HTML/CSS/JS, within `.browserslistrc` (iOS/Safari 17, Chrome/Edge 120: devices up to about five years old, which can all update to that). Vite doesn't read it: keep `TARGET` in `vite.config.ts` the same.
- Always try to use browser native features as much as possible

## Branches and pull requests

Changes reach `main` only through pull requests (`docs/CI.md`): never commit to or push `main`.

- Work on a branch, `<agent>/<topic>` (e.g. `claude/pad-fades`), in a git worktree of your own when
  another agent may be working in the same checkout: inside the repository, in
  `.claude/worktrees/<topic>` (git-ignored; what `claude --worktree` makes), not next to it.
- Commit as you go, one logical step per commit; keep other people's uncommitted work out of them.
- Before asking for review: rebase on `origin/main`, run `just ci` (the checks CI runs, on Linux), and
  `git push --force-with-lease`. Open the pull request as a draft with `gh pr create`, and mark it
  ready when `just ci` passes.
- Never merge your own pull request. They are merged with "Rebase and merge": no merge commits.
- At the end of a session, `just wrap-up`: it fast-forwards the primary checkout's `main` to
  `origin/main` and lists the worktrees and branches whose pull request has merged (`--prune`
  removes the clean ones). A session confined to its own worktree cannot touch the primary checkout:
  say so and ask the user to run it (`! just wrap-up`).

## Log of what the tests catch

When a test fails and the cause turns out to be a real defect in the app code (not a wrong test,
a flake, or an intended change of behaviour), append one JSON line to `docs/test-catches.jsonl`
before moving on:

    {"date": "2026-10-14", "suite": "node|unit|e2e", "test": "file › name", "kind": "regression|existing-bug", "summary": "one sentence", "fix": "#PR, or uncommitted", "caught_by": "new-test|existing-test"}

- `regression` is a bug in code being changed at the time; `existing-bug` was already there.
- A bug caught in work in progress counts: that is a test doing its job.
- `caught_by` (for `regression` and `existing-bug` only) is `existing-test` when a test that was
  already there failed, which is what keeping a suite pays for, and `new-test` when a test written
  with the change found it. Leave it off `test-bug` and `flaky`.
- Also log failures where the test was wrong or flaky, with `kind` `test-bug` or `flaky`, so we can
  see which tests cost more than they catch.
- Don't log an expected failure (a test written first), or a failure whose cause is not diagnosed
  yet. Breaking the source on purpose to check a test (a mutation check) is not a catch.
- `fix` is the number of the PR the fix is in (`"#42"`), not a sha: GitHub's "Rebase and merge"
  gives a PR's commits new shas on `main`. Older entries have shas. Fill in an `uncommitted` entry
  once the PR is open.

`just test` also records counts, run times and coverage in `docs/stats.jsonl` (one line per commit,
by `scripts/stats.ts`), so the history of both is in the repo.
