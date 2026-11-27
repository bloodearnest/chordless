# The speed test

`/speed-test` times made-up songs on the device it is opened on, and gives a report to copy or send. It
is for a device that feels slow, which only the device can describe: an old iPad is the case it was
made for (iOS 17 has no `content-visibility`, so every song of a setlist is laid out at once).

It is linked from the Contact page, and is a page of the app like any other (`docs/ROUTING.md`).

## What it does

It draws a setlist of made-up songs (`js/speed-test/chart.ts`: four sections of six lines, eight
words to a line and a chord over every other word, the same on every device and every run) in a
scrolling stage on the page, three ways (`js/speed-test/variants.ts`), at 5, 16 and 32 songs:

| Way | What it is | What comparing it shows |
| --- | --- | --- |
| `real` | `song-display`, `song-section` and `chord-display`, as a setlist is drawn | the whole cost |
| `lyrics` | the same components, with no chords | what the chords cost: each chord is a component of its own |
| `plain` | the same words and chords as ordinary elements, with no custom element or shadow root | what the text costs by itself, with none of the components' |

Real against plain says whether the components are the cost; real against lyrics says whether it is
the chords. If plain is as slow, the answer is to draw less (only the songs near the one in view),
not to change how a song is built.

Each timing (`js/speed-test/runner.ts`, `measure.ts`) gives:

- `buildMs`: the call that puts the songs in the page.
- `firstPaintMs`: until the browser had painted after it. The page's own report has the same measure
  for a real setlist (`chordless.setlist.first_paint_ms`, `docs/OBSERVABILITY.md`).
- `settledMs`: until every component under the page had rendered (a song makes its sections, a
  section its chords: each is waited for), and the browser had painted after that.
- the size of the page: elements, shadow roots and components, counted inside every shadow root.
  (The page's `chordless.setlist.dom_elements` counts the page and each song's shadow root and no
  deeper, so it is smaller than the page is.)
- how smoothly it scrolls: the stage is scrolled at a flick's speed (1200 px a second) for 2.5 s, and
  the gaps between `requestAnimationFrame` callbacks are summarised: frames, long ones (50 ms or
  more, as `js/telemetry/frames.ts` counts them), the worst, the median and the 95th percentile. The
  median shows the device's refresh rate (8 ms at 120 Hz; 33 ms under Low Power Mode).

A first drawing of one song is not timed (the first is slower than the rest for reasons that are not
the page's). The songs are made before the clock starts, and the page says what is next before each
timing begins, so neither is in a timing. The run takes about a minute on a slow device; it can be
stopped, and gives what it had. Leaving the page ends it.

If the page is hidden while it runs (the screen locks, another app comes in front) a browser makes
no frames, and the numbers are wrong: the report says so.

## What it says

`js/speed-test/report.ts` makes plain text: the Contact page's details (the Support ID, the version,
the device, the browser, the user agent: `js/contact.ts`), then the cores, reduced motion and whether
there is a service worker, when it ran and for how long, what the person wrote about the device
(a box for anything else, and a choice for Low Power Mode, which a page cannot see), and a line for each timing.
The wording of the report is in code, as the Contact page's is: it is for us to read. A line is
for a timing, so a report that stopped early is shorter.

The person can send it by copying it or by starting an email (`emailBody`, `emailLink`: the same as the
Contact page).

## What goes to Honeycomb

When a test ends, each timing is sent as a span, `chordless.speedtest.run` (`js/speed-test/telemetry.ts`,
through `recordSpan`), with the numbers as attributes. They go with the app's other usage reports and
by the same switch: **with usage reports off nothing is sent**, the page says so before the test and
after it, and the report is still there to copy or email. Reports are on unless a person turns them
off (`docs/OBSERVABILITY.md`, Identity), so by default the timings reach us without anyone sending
anything, under the device's id: that is what makes "how does this run on an old iPad?" a query across
every device that has run it, rather than a message from each.

Each span has the same attribute names, so that Honeycomb can break down by them (an id, or a
variant or a size, is a value, never part of a name): `chordless.speedtest.id` (one per test, shared
by its spans), `.variant`, `.songs`, `.order` (its place in the run: a device that gets hot is slower
later), `.build_ms`, `.first_paint_ms`, `.settled_ms` (both left off if no frame came), `.elements`,
`.shadow_roots`, `.components`, `.scroll_frames`, `.scroll_long_frames`, `.scroll_worst_ms`,
`.scroll_median_ms`, `.scroll_p95_ms`, `.hidden`, `.stopped`, `.total_ms`, `.cores`,
`.reduced_motion`, `.controlled` (a service worker has the page), `.low_power` (`on`, `off` or
`unknown`: what the person said, as a page cannot see it), `.outcome` and `.report_version`. The
browser, OS, screen, pixel ratio, display mode and device id are on every span already
(`baseline.ts`). A test that cannot finish is one span with `.outcome` `error`, and the error's class
and message (`.error`, `.error_message`), as the app's other errors are.

- "Where does the time go on an iPad?" is `P50(chordless.speedtest.settled_ms)` and
  `P95(chordless.speedtest.scroll_long_frames)` by `chordless.speedtest.variant` and
  `chordless.speedtest.songs`, where `os.name` is `iPadOS`.
- "Is it the components?" is the same for `real` against `plain`. "Is it the chords?" is `real`
  against `lyrics`.
- A device's own tests are `device.id` (the Support ID is its first eight characters).

**What is not sent:** what the person writes in the note box (it could say anything: it is only in the
report they copy or email), and anything of a song. The songs are made up, so no title, lyric or
chord of anyone's has been in the test. The Support ID is in the report, and the device id is on
every span, as it is for every report.

## Where it is

| | |
| --- | --- |
| `src/js/speed-test/chart.ts` | the made-up songs |
| `src/js/speed-test/variants.ts` | the three ways of drawing them |
| `src/js/speed-test/measure.ts` | counting a page, waiting for its components, timing a drawing, scrolling, summarising frames |
| `src/js/speed-test/runner.ts` | running every size and way, in order, with progress and stopping |
| `src/js/speed-test/report.ts` | the report, and what the device says of itself |
| `src/js/speed-test/telemetry.ts` | the spans sent to Honeycomb |
| `src/components/app-speed-test.ts`, `src/js/views/speed-test-view.ts` | the page |
| `tests/speed-test.test.ts`, `tests/speed-test-telemetry.test.ts`, `tests/app-speed-test.test.ts` | tests (small sizes: a setlist of one or two songs) |

## Reading a report

On a device that is slow, look first at `real` against `plain` at the same size, then `real` against
`lyrics`. Then the page's size (`elements`, `shadow roots`, `components`), and the scrolling: a high
share of long frames with a median near the refresh rate is a device that is mostly fine and
sometimes drops frames; a median over 30 ms is a device that is throttled (Low Power Mode) or
overloaded by everything it has open or by browser extensions that run on every page.
