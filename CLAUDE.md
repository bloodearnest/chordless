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

## Tech Stack

- we are using an offline first approach, with proper url navigation and page reload, handled by a service worker
- we are using newer css techniques to do the transition to avoid FOUC and other things.
- we are using lit for components
- we are using service worker
- we are using google auth and gdrive api for remote storage
- we are using cloudflare workers as out deployment, and wrangler locally

## Development Standards

- Use `just format lint test` to verify all changes. This runs formatting, linting, and all three test suites: node tests, browser unit tests (Web Test Runner) and Playwright tests.
- How the tests are organised, and how to write them: `docs/TESTING.md`. How navigation works (the app is a single page): `docs/ROUTING.md`. Other design and architecture docs are in `docs/` too.
- Vanilla JS and Lit, built and served with Vite (with `@cloudflare/vite-plugin`, which runs the Worker next to it). There is no build in dev: Vite serves the modules as they are. Production is `vite build`. Keep it that thin: no frameworks, no transpiling beyond what the browser floor needs. Dependencies are npm packages, imported by name and bundled by Vite
- The service worker is built as a classic script with the whole app precached (`vite-plugins/service-worker.ts`); see `docs/BUILD.md`
- Use modern HTML/CSS/JS, within `.browserslistrc` (iOS/Safari 17, Chrome/Edge 120: devices up to about five years old, which can all update to that). Vite doesn't read it: keep `TARGET` in `vite.config.ts` the same.
- Always try to use browser native features as much as possible
