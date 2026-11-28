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
- annotations on a chart ("repeat this 4 times", "drop out here": `docs/ANNOTATIONS.md`)

Extra features I would like to add

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
- Read-only (a reader on a church team, or someone with a share link) should only stop writing
  back to sync, never local edits: a last-minute key change must work for them too. (A received
  share's page is still read-only, see the TODO.)

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

## Churches, spaces and copyright

Chordless may store song charts, lyrics, MusicXML, source PDFs and pad audio in its own R2 storage,
scoped to a church or personal library. The app no longer syncs with the user's Drive: a church's
teams are Chordless's, and a Personal space still linked to a Drive folder moves to Chordless at its
next sync (`docs/CENTRAL_STORAGE.md`). Source PDFs were never in Drive, so they are not moved with it.
Do not claim that content has moved before it has. Keep access private and authorize it against the relevant church or personal account;
an object key is not authorization. Anonymous shares are deliberately public to a holder of an
unguessable, expiring link, served through the Worker. Never send whole charts or PDFs to telemetry.

D1 keeps accounts, membership, roles, invites, the retained church register, library and setlist
metadata, checksums and references to stored content. Source PDFs remain immutable and outside routine
device sync. The live channel carries only "changed", not a setlist, chart or key. Honeycomb may keep
fragments of titles or lyrics for its 60-day retention (`docs/OBSERVABILITY.md`). Update privacy copy
when behavior changes. The current implementation calls its personal and Team workspaces **spaces**;
the target model is churches with a shared library and teams, plus a personal space. Existing stored
names and IDs must remain compatible during migration (`docs/CHURCH_TEAM_DESIGN.md`).

## Tech Stack

- we are using an offline first approach, with proper url navigation and page reload, handled by a service worker
- we are using newer css techniques to do the transition to avoid FOUC and other things.
- we are using lit for components
- we are using service worker
- we are using google sign-in; the songs, setlists and people are kept by Chordless itself (the Worker, D1 and R2), and the device keeps its own copy
- we are using cloudflare workers as out deployment, and wrangler locally

## Development Standards

- Use `just format lint test` to verify all changes (and `just ci` before a pull request: `docs/CI.md`). This runs formatting, linting (Biome, `tsc -b` over the tsconfig.*.json projects, knip for unused files, exports and dependencies, and a dry-run deploy of `wrangler.toml` that fails on warnings: `scripts/lint-wrangler.sh`), and all three test suites: node tests, browser unit tests (Web Test Runner) and Playwright tests.
- Never install or fetch npm packages yourself: no `npx <package>` that is not already installed, no `npm install -g`, no `npx @biomejs/biome` (it pulls whatever version is newest, not the pinned one, and has reformatted files and reported errors CI does not). Go through the tooling: `just` recipes, and the `node_modules/.bin` the lockfile installed (`npm ci`, in the checkout you are working in; a git worktree needs its own). If a tool is missing, install the project's dependencies; if a package is needed, add it with `npm install` as a reviewed change to `package.json` and the lockfile.
- **Before adding or changing a table, column or index in `migrations/`, read `docs/SCHEMA_RULES.md`**: `STRICT` tables, declared foreign keys, no `''` for "not set", `WITHOUT ROWID` only for small rows, ULIDs for new ids, one table per kind of record, and how a migration is written and tested. A test fails a table that is not `STRICT` or a `*_id` column with no foreign key.
- How the tests are organised, and how to write them: `docs/TESTING.md`. The interface between the Worker's Drive code and wherever files are kept: `docs/STORAGE_API.md`. How navigation works (the app is a single page): `docs/ROUTING.md`. Other design and architecture docs are in `docs/` too (`docs/SPACES.md` for spaces, `docs/SHARING.md` for share links, `docs/ANNOTATIONS.md` for typed notes on a chart, `docs/PERSONAL_LAYER.md` for who changes a setlist and what each person keeps for themselves, `docs/SYNC_ARCHITECTURE.md` for sync, `docs/MIGRATIONS.md` for changing the shape of stored data (the database on a device, and Drive: roll forward only), `docs/AGENT_VMS.md` for running an agent in an Incus VM away from the developer's computer, `docs/OBSERVABILITY.md` for traces to Honeycomb (what is traced, the session and identity model, the Worker's telemetry route), `docs/ENVIRONMENTS.md` for dev and prod (two Google Cloud projects), `docs/CCLI.md` for what CCLI's and SongSelect's terms mean for the app and the licence number, `docs/LEAD_SHEETS.md` for lead sheets kept as MusicXML, `docs/CENTRAL_STORAGE.md` for the design (not built) of keeping setlists, people and later preferences in D1, with songs on the device, `docs/COPY.md` for the words the app says, which live in `src/text/en.ts` and are asked for with `t('name')`: never write user-facing text into code or a template).
- TypeScript (erasable syntax only: no enums or parameter properties, so Node and esbuild can strip the types) and Lit, built and served with Vite (with `@cloudflare/vite-plugin`, which runs the Worker next to it). There is no build in dev: Vite serves the modules as they are. Production is `vite build`. Keep it that thin: no frameworks, no transpiling beyond what the browser floor needs. Dependencies are npm packages, imported by name and bundled by Vite
- Infrastructure that rarely changes is Terraform in `infra/` (`infra/README.md`): the Cloudflare zone side (Email Routing, the Worker's custom domain, DNS, TLS settings) and the Google Cloud project (APIs, API keys, service account). Deploys, and everything in `wrangler.toml`, stay wrangler's: do not move the Worker, its assets, bindings or secrets into Terraform. `gcloud` and `terraform` come from `mise.toml`
- The service worker is built as a classic script with the whole app precached (`vite-plugins/service-worker.ts`); see `docs/BUILD.md`
- Use modern HTML/CSS/JS, within `.browserslistrc` (iOS/Safari 17.4, Chrome/Edge 120: devices up to about five years old, which can all update to that). Vite doesn't read it: keep `TARGET` in `vite.config.ts` the same.
- Always try to use browser native features as much as possible

## Branches and pull requests

Changes reach `main` only through pull requests (`docs/CI.md`): never commit to or push `main`.

- Work on a branch, `<agent>/<topic>` (e.g. `claude/pad-fades`), in a git worktree of your own when
  another agent may be working in the same checkout: inside the repository, in
  `.claude/worktrees/<topic>` (git-ignored; what `claude --worktree` makes), not next to it.
- Commit as you go, one logical step per commit; keep other people's uncommitted work out of them.
- Before asking for review: run `just ci` (the checks CI runs, on Linux), and push the branch.
  Stacked PRs target the branch below them; merge from the bottom up without rebasing merely because
  a lower PR landed. Rebase only when changes or conflicts require it, then rerun checks.
  Open the pull request with `gh pr create`, ready for review (a draft only for a spike).
- **Read the result of every check; never throw it away.** Do not send a check's output to `/dev/null`
  or run it and look only at the next one: a suite's failure then goes unseen and reaches CI (a removed
  component left two unused messages, which the node tests catch, and the node tests had been run with
  their output discarded). Run every step `just ci` runs, one at a time, each with its exit status and
  failure lines in view: format and lint (Biome, `tsc -b`, knip), the node tests, the browser unit tests,
  `just coverage-check` after a full run of both, and Playwright. If `just ci` cannot run to the end here
  (the dependency audit needs the network and `node_modules`), run the rest by hand: that is no reason
  to skip any of them. Say a check passes only when its result was seen to; when one was not run, say so.
- Never merge your own pull request. They are merged with "Create a merge commit": no rebase or squash.
- At the end of a session, `just wrap-up`: it fast-forwards the primary checkout's `main` to
  `origin/main` and lists the worktrees and branches whose pull request has merged (`--prune`
  removes the clean ones). A session confined to its own worktree cannot touch the primary checkout:
  say so and ask the user to run it (`! just wrap-up`).

## Previewing a branch for the user (away from the computer)

When the user wants to try a branch on a phone or tablet, serve it (`docs/PREVIEWS.md`):

- Push the branch (or have it checked out in a worktree), then `just branch-preview <branch>`; it prints the
  `https://<machine>.<tailnet>.ts.net` address. `just branch-preview-status` and `just branch-preview-stop`
  say and end it. One preview at a time, always on the same address (so it stops the one before); its port is 8790, not 8787, so a `just serve` can run beside it.
- If the script says its port is in use, something else is on it (or an earlier preview did not stop).
  Tell the user, and do not kill a process you did not start.
- Give the user the address, and what to look at in the branch. Sign-in is Google, each time site data is
  cleared. A Personal space with no songs imports `test-export.zip` (the primary checkout's root; git-ignored,
  the user keeps it up to date): never commit it, upload it, or put it anywhere but that disk.
- Leave it running when you finish (the user is testing on it); stop it only if asked. A branch that raises
  `DB_VERSION` can break an older branch's data on that origin: say so if yours does.

`just test` also records counts, run times and coverage in `docs/stats.jsonl` (one line per commit,
by `scripts/stats.ts`), so the history of both is in the repo.
