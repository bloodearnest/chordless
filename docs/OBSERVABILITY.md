# Observability

Traces from the page and the Worker go to Honeycomb (OpenTelemetry, OTLP), so that before and after
going live we can see what the app does in the field: sync failures, slow Drive calls, auth
refreshes, how a setlist session goes, how long a live update takes to reach a follower. Honeycomb's
environments and keys are Terraform (`infra/honeycomb/`); the Worker's secret is wrangler's, as ever
(`infra/README.md`).

**Status:** designed, being built in steps (below). Built so far: the Worker's own traces to Honeycomb
(step 1, live since 2026-10-27), the Worker's telemetry route (step 2, live 2026-10-28) and the page's
SDK (step 3, live 2026-10-28), then the setlist session with its two spans and the Support ID in
Preferences (step 4a, below). Still to do (step 4b and c): the account and
team ids kept in synced data, and the live-update latency.

## Decisions

- **Traces only.** No OTel metrics, no OTel logs from the page. Workers Logs stay in Cloudflare. SLOs
  and triggers in Honeycomb are queries over spans.
- **The page sends through the Worker**, `POST /api/otlp/v1/traces`, same origin (so the CSP's
  `connect-src 'self'` is unchanged and ad blockers are less likely to catch it). The ingest key is a
  Worker secret; a browser cannot keep one. No OTel Collector: the route does the parts of a
  collector we need (below).
- **Offline is supported, not primary.** Telemetry lost offline is fine. The exporter drops a batch
  that fails; no persistent queue, nothing in the service worker. A bounded in-memory queue covers
  short drops. A telemetry failure never reaches the UI and is never a `toast()`.
- **On by default, with a preference to turn it off** (changes without a reload).
- **No sampling** for now. See "If volume grows".
- **What may be in a span (decided 2026-10-28):** setlist uuids, service dates, CCLI numbers, URLs, and
  fragments of lyrics or titles where they help (an error that names a song). Honeycomb keeps events for
  60 days, so this is a limited, third-party copy of fragments, and the privacy text says so. **Never an
  email address**: the Worker route blanks every one it finds (`[email]`), in any text, and that is the
  only content rule it enforces. Not a reason to send whole charts or lyrics: spans are for what the
  app did, and each attribute is sized (2 KB at most).
- Chordless's own servers store no copyrighted content (CLAUDE.md): the route parses a small body in
  memory and forwards it. Nothing is written to KV, R2, a Durable Object or the cache. (CLAUDE.md's
  headline rule says Chordless never stores copyrighted content: Honeycomb's 60 days of fragments is
  an exception to it, so the wording there and in `public/privacy.html` needs to say so.)

## Conventions

1. **Attributes over spans.** Few, wide spans. Durations, counts and outcomes are attributes on a span
   that exists anyway. A new span only for a real operation with a network call or children.
2. **Standard names first; ours start with `chordless.`** (`chordless.sync.pull_ms`,
   `chordless.setlist.id`). Standard where one exists: `service.name`, `service.version`,
   `deployment.environment.name`, `session.id`, `enduser.pseudo.id`, `device.id`,
   `user_agent.original`, `http.*`, and the `exception` event.
3. **Cardinality is a feature.** Setlist uuids, ids and CCLI numbers go on as they are. Ids are values,
   never part of an attribute name (Honeycomb limits the columns of a dataset).
4. **One home for each fact.** An error is an `exception` event on the active span, not also a log
   line or a second span.
5. **Cost is per span, attributes are free.** Hence the baseline attributes below.
6. **Vendor neutral.** The route's destination is `OTLP_ENDPOINT` (a var, `https://api.eu1.honeycomb.io/v1/traces`:
   our Honeycomb team is on the **EU** instance, a different host from the US one) and `OTLP_HEADERS` (a
   secret, `x-honeycomb-team=<key>`): moving backend is configuration.

## What is traced

| Span | Where | Attributes |
|---|---|---|
| `chordless.sync.run` | `SyncOrchestrator.#execute` | operation, space kind, pulled and pushed counts, pull and push ms, Drive and Worker call counts, total and max Drive ms, error count, outcome. A span *event* for each failed or slow request (a cap on volume), not a span per request |
| `chordless.setlist.open` | `SetlistPage` start | open ms (load time, from navigation timing), songs, CCLI numbers (a comma-joined string, queried with `contains`: Honeycomb does not query array elements), source (library or share) |
| `chordless.setlist.leave` | `dispose()` and `pagehide` | songs viewed, song changes, transposes, edit-mode entries |
| `chordless.live.receive` | a follower receiving `changed` | see "Live update latency" |
| Worker request | Cloudflare's native export | |
| Errors | `toast()` errors, `window` `error` and `unhandledrejection`, the sync catch | an `exception` event on the active span, plus `chordless.error`; class and message only |

Other work (auth refresh, share open, import, pad loading) is an attribute (`..._ms`, outcome, counts)
on whichever of those spans encloses it.

**On every browser span**, stamped when it starts by one span processor from a small in-memory store
(not as resource attributes, because they change: sign-in, a reset, switching space): `device.id`,
`enduser.pseudo.id` (signed in), `chordless.team.pseudo_id` (a team space), `chordless.space_kind`;
in a setlist, `session.id` (so a sync or an error during it joins it); and
`chordless.route` (the template, not the URL), `chordless.live`, `chordless.online`,
`chordless.display_mode`. **Not the setlist or the song in view** (decided 2026-10-28): they would
make a background sync look as if it were about the song on screen. A span that is about them names
them itself (`chordless.setlist.id`, `.date` on the open and leave spans); a song-specific span,
when there is one, adds `chordless.song.*` itself. Resource attributes: `service.name` (`chordless-web`), `service.version`,
`deployment.environment.name`, `user_agent.original` (the browser and device mix: the app targets
older devices).

**Not traced** (they cost spans): page-load resource spans (`instrumentation-document-load` is not
used; timings are attributes), user interaction spans (key and scroll activity are counters on
`chordless.setlist.leave`), and the fetch to the telemetry route itself.

## Sessions

A session is a **setlist session**: opening a setlist starts it, leaving it or closing the tab ends it.
There is no idle timeout and no engagement analysis: the app has no use for either. `session.id` is
Honeycomb's special field (it drives their session views); it is a UUID made when a `SetlistPage`
starts, and in live mode the live session's id, so a reload mid-service stays the same session. Spans
outside a setlist have none. No span is held open for a session: length is a query, MIN to MAX of
`time` grouped by `session.id`, and two short spans (`open`, `leave`) mark the ends. A tab that dies
before `leave` loses that span's counters.

## Identity

Anonymous, and re-identifiable only when the user gives the id to us.

- `device.id`: a random UUID in localStorage. Safari may evict it for a site that is not installed, so it
  is stable in practice, not guaranteed.
- `enduser.pseudo.id` (signed in): a random UUID kept in the user's **own synced data** (their
  Drive, by the sync engine), so every device picks up the same one. It is not derived from the
  account, email or `sub`, and the Worker keeps no mapping: nobody can derive or reverse it, and there is no
  secret whose rotation would unlink everyone. Two devices that each make one before syncing keep the
  lowest. Where it lives in the synced data is still to decide (`docs/SYNC_ARCHITECTURE.md`).
- `chordless.team.pseudo_id`: the same, in the team space's own synced data, made by a worship
  leader's client and regenerable by the leader for that team only.
- The user sees a **Support ID** (the first 8 characters of `enduser.pseudo.id`, or of `device.id` when
  signed out), with a copy button, and the contact form (when there is one) includes it. We find
  their traces with a starts-with query. "Reset Support ID" makes new ones; turning telemetry off
  stops sending them.
- The privacy text (`public/privacy.html`) says what is sent, that signed-in use can be linked across
  devices, and for how long Honeycomb keeps it (set per dataset in Terraform).

## The Worker route

**Built** (`worker/src/telemetry.ts`, tested in `tests/telemetry.node.test.ts`), `POST /api/otlp/v1/traces`. It is
the small collector: authentication and abuse limits, redaction, forwarding.

- Same origin only (`isCrossOrigin`, `Sec-Fetch-Site: same-origin` for a beacon); `application/json`
  only; a body size cap (256 KB, also when the sender does not say how big it is); a rate-limit
  binding by address (`TELEMETRY`, 600 a minute: a band shares one wifi address; repeated in
  `[env.dev]`). A refusal is 403 (another origin), 405, 413, 415, 400 (not JSON, or no span left) or 429;
  a limit that cannot be asked about lets the batch through.
- **Rebuilt, and emails blanked:** the capped body is parsed in memory and **rebuilt field by field**
  from what we know of OTLP/JSON: an unknown field does not pass, an attribute passes with a name that
  looks like one (lower-case words and dots, at most 100 characters, or `SampleRate`: not an id or a
  sentence, which would make a column of each) and a plain value (no list or map) of at most 2048
  characters, at most 64 attributes a span, 500 spans a batch. A scope keeps its name and version and
  loses its attributes. **Every email address in any text** (values, names, events, resource, status
  message; also percent-encoded in a URL) is replaced with `[email]`. Nothing else is judged: lyrics
  fragments and URLs pass. Never stored, never logged.
  A sender that is not our page (anyone can POST here, as `curl` sends no `Origin`) can still make
  columns in the dataset with names of that shape, and spend events: the rate limit is the bound, and
  Honeycomb's column limit is the one to watch (see "Open questions").
- Forwards, after answering, to `OTLP_ENDPOINT` (a variable in `wrangler.toml`, repeated in
  `[env.dev.vars]`, https only) with `OTLP_HEADERS` (`name=value,name=value`, as
  `OTEL_EXPORTER_OTLP_HEADERS` has it; an optional secret). No headers or endpoint (local development
  without a key): the batch is accepted and dropped.
- Answers 204 to a good batch, whatever upstream says; an upstream failure is logged as a status
  or an error's name, never what was sent.
- The secret: `wrangler secret put OTLP_HEADERS` is `x-honeycomb-team=<prod_ingest_key>` (and for
  `npm run dev`, `OTLP_HEADERS=x-honeycomb-team=<dev_ingest_key>` in `.dev.vars`).

## What the Worker's native export carries

Checked in Honeycomb on 2026-10-27. The Worker's traces are in a dataset named `chordless` (the
service name; `cloudflare-workers-observability` holds only the destination's test event). A request is a
root `GET` or `POST` span, with an outbound `fetch` child where the Worker called out (the Google token
exchange is a child of `/session/refresh`). Error statuses are traced too, but Cloudflare's own
`status_code` stays unset for a 4xx and `cloudflare.outcome` is `ok` when the Worker ran: **failure is
`http.response.status_code`**, so Worker triggers and SLOs filter on that (`>= 500`).

This export does not go through the telemetry route, so **its attributes are not redacted**. It carries
the geography of the sender (country, region, city) and the network (ASN) from the address, the parsed
user agent, the Cloudflare ray id, and the URL as it came: `url.path` has the ids of spaces and shares
(`/api/space/<id>/...`), which are identifiers, not content. There is no `http.route`, so group by
path with care. The privacy text says all of this. (No client address is exported.)

## Context propagation

`traceparent` goes to the same-origin Worker only, never to Google (a CORS preflight, and trace ids
leaked to a third party), so browser and Worker spans are one trace and Drive calls are leaves.
Honeycomb's trace-level filters (parent, child, root) join them.

The browser has no async context: there is no `AsyncLocalStorage`, and the default context manager
loses the *active* span across `await` (the TC39 AsyncContext proposal is not available). A span can
live across any number of awaits, but a span or auto-instrumented fetch started after one has no
implicit parent and becomes a root. zone.js is the usual answer and cannot follow native
`async`/`await` (it needs code down-compiled to ES2015, against our Safari 17.4 floor). So parents are
passed explicitly where we want children: the follow-up fetches of a live update (five at most) are
child spans of `chordless.live.receive`, which we hold in a variable. The requests inside a sync are
many, so they are aggregates and events on `chordless.sync.run`. Fetch child spans under a sync are
a later option, if the data shows the aggregates are not enough.

## Live update latency

`docs/LIVE_SYNC.md` lists "measuring the real latency" as undone. The socket carries `changed`
(`src/js/live-protocol.ts`), and the content moves by a sync after it, with follow-up fetches at
`FOLLOW_UPS_MS` when the first finds nothing. The follower's span, `chordless.live.receive`, records
each leg:

- On the follower's own clock (`performance.now()`, no protocol change): `chordless.live.sync_ms`
  (`changed` received to the content applied), `chordless.live.attempt` (0 for the immediate fetch, 1 to
  4 for the follow-up that found it) and `chordless.live.found`. The attempt answers whether the
  follow-ups are needed and are enough. The leader's `chordless.live.publish_ms` is edit to `changed` sent.
- Across two devices: `changed` gains optional metadata, never content: `sentAt` and a `traceparent`
  (the follower's span has a **span link** to the leader's, the messaging shape), and the Durable
  Object adds `relayedAt` when it relays. The follower records `chordless.live.transit_ms`, split into
  `chordless.live.up_ms` (leader to server) and `chordless.live.down_ms` (server to follower).
- Device clocks differ, so each client estimates its offset to the server's clock with one round trip
  on connect (Cristian's algorithm), sends `sentAt` already corrected, and records
  `chordless.live.clock_offset_ms` and `chordless.live.rtt_ms` so bad samples can be dropped. The
  answered `pong` is a fixed string, so the probe is a new message, `time`, answered with the
  Object's clock and nothing else.

## Honeycomb and Terraform

`infra/honeycomb/`: an environment for each of `chordless-prod` and `chordless-dev`, and an ingest
key for each. Datasets are made by the first span (the key may create them). Starter SLOs and triggers
come once there are datasets: they need a configuration key for the environment, apart from the
management key the stack uses. The provider is set to the EU host (`api_url` in `main.tf`: a US key or
host gives "invalid API key"). It needs a **management key** (`HONEYCOMB_KEY_ID` and
`HONEYCOMB_KEY_SECRET`) with the `environments:write` and `api-keys:write` scopes. The ingest
key is set as the Worker's secret by hand (`infra/README.md`):

    wrangler secret put OTLP_HEADERS            # x-honeycomb-team=hcaik_...   (and --env dev)

Retention is set explicitly, and is what the privacy text says.

## The Worker's own spans

Cloudflare's native export sends the Worker's traces (handler, fetch, binding and Durable Object
calls) to an OTLP destination. The destination is made **in the Cloudflare dashboard** (Observability,
Destinations; type Traces, endpoint `https://api.eu1.honeycomb.io/v1/traces`, header `x-honeycomb-team`),
not in `wrangler.toml` or Terraform, so it is a by-hand step, like a secret. Cloudflare sends JSON,
which Honeycomb accepts. It is in beta, and exports traces and logs separately and not metrics. The
Worker then lists the destination:

    [observability.traces]
    enabled = true
    head_sampling_rate = 1
    persist = false          # export only: do not also keep them in Cloudflare
    destinations = ["honeycomb-traces"]

The destination `honeycomb-traces` exists (made 2026-10-27, with the production ingest key), and the
block is in `wrangler.toml`, with traces turned off for `[env.dev]` (the destination has the
production key). The `destinations` key is as Cloudflare's examples show it, but their page on
tracing does not. Wrangler's dry-run (`scripts/lint-wrangler.sh`) accepts the block without a
warning, but that does not check the destination, so the first deploy is the test. `persist = false` matters:
from 1 December 2026 Cloudflare bills the traces it stores. Whether an incoming `traceparent` is
honoured is not documented, so the first thing to check is that a page's trace and the Worker's span
share a trace id in Honeycomb.

## If volume grows

Honeycomb bills by event, and we do not sample. If that has to change, in this order:

1. **Stateless sampling in the route**: keep or drop by a hash of the trace id (the same decision
   for every span of a trace), always keep errors and slow spans, and stamp the sample-rate
   attribute (`SampleRate`, to be checked) so Honeycomb scales its counts. It covers the page's spans only, since the
   native export does not pass through the route. With one wide span per operation this is nearly
   tail sampling.
2. A Durable Object per trace id for real tail sampling. It would need a decoder for the native
   export's format and a change to CLAUDE.md's list of what a Durable Object may hold.
3. Honeycomb Refinery or an OTel Collector, in a Cloudflare Container or a VM. The Collector cannot run
   as a Worker.

## The page (built, step 3)

`src/js/telemetry/`. The facade, `telemetry.ts`, is only the small `@opentelemetry/api` package, so any
file may use it: until the SDK is loaded, and whenever the preference is off, every call does nothing.
The SDK (`start.ts`: `sdk-trace-web`, the OTLP/HTTP exporter, `resources`) is loaded when the page is
idle, only if reports are on, and again when they are turned on.

- `traced(name, attributes, fn, { trackCalls })`: a span that records how it ended (`chordless.outcome`,
  an exception on error). With `trackCalls` it also counts the Drive and Worker calls made while it
  runs (`timedFetch('drive')` on the page's Drive API, `timedFetch('worker')` in `callWorker`):
  `chordless.sync.drive_calls`, `drive_ms_total`, `drive_ms_max`, `worker_calls`, `errors`, and a span
  event (`chordless.call`) for each of the first ten calls that failed or took over two seconds.
  Only one sync runs at a time (the sync lock), so the one "tracked" span is a module variable, not
  async context. A call to our Worker made during a sync carries its `traceparent`; one to Google never.
- Spans made so far: `chordless.sync.run` (`SyncOrchestrator`), `chordless.auth.refresh` (a span of its
  own, not an attribute: how long the Worker took is its duration, and a sign-in that has expired
  is its error), and `chordless.error` (an unhandled error, an unhandled rejection, or a `toast()` error:
  at most 20 a visit). No auto-instrumentation: no fetch, document-load or interaction spans.
- Every span gets `baselineAttributes()` as it starts: the device id, the page's name, live, online,
  the display mode, and what `context.ts` knows (nothing yet: step 4 sets the session, setlist, song and
  account ids there). Resource: `service.name` `chordless-web`, `service.version` (the service
  worker's), `deployment.environment.name`, `user_agent.original`.
- Batches go every five seconds, and when the page is hidden or left, through `GatedExporter`, which
  drops a batch while offline or when reports are off (nothing is queued across page loads).
- Preference `telemetry` (Preferences, "Usage reports"; on unless `false`; off where storage cannot be
  read). Turning it off deletes the device id.
- To see spans without Honeycomb: `localStorage.setItem('telemetry-console', '1')` and reload.
- Deferred: the space kind and the team and account ids (the sync span has no
  `chordless.sync.space_kind` yet), which come with the ids in synced data.
- Tests: `tests/telemetry.test.ts` (unit, with an in-memory exporter), `tests/telemetry.playwright.ts`
  (the page's real batch, with the service worker blocked so that Playwright can see the request).
  The unit tests resolve packages as a browser does (`web-test-runner.config.js`): OpenTelemetry has
  a Node and a browser build of some files.

## The setlist session (built, step 4a)

`src/js/telemetry/setlist-session.ts`, called from `SetlistPage`. When a setlist has loaded
(`start()`), `startSetlistSession` makes the session id (a UUID, or while live
`<device>-live-<startedAt>`, so a reload mid-service stays one session), puts it where
every span gets it (`context.ts`), and records `chordless.setlist.open`: `chordless.setlist.id` and
`.date`, `.songs`, `.ccli` (comma-joined), `.source` (`library` or `share`) and `.open_ms`.
`dispose()` and `pagehide` end it with `chordless.setlist.leave`: the setlist's id and date again,
`.session_ms`, `.songs_viewed`, `.song_changes` (a different song or the overview, not a re-render
of the same one), `.transposes` and `.edit_entries`. The song in view is only counted, for those:
no span carries it. The `pagehide` listener is a capturing one, so the leave span is made before the SDK's own flush on pagehide sends it.
Both spans are made and ended at once: a span held open for the length of a setlist would be
invisible until it ended, and lost with the tab.

The **Support ID** is in Preferences, "Usage reports": the first eight characters of the device
id, with Copy and Reset (Reset forgets the id; a new one is made at once). It is not shown while
reports are off. There is no contact form yet to put it in.

Not done, on purpose: the share, import and pad attributes (they would be on a span that encloses them,
and the setlist spans no longer enclose anything; each becomes a span of its own when the data says it
is worth one).

## Steps

1. This page; `infra/honeycomb/`; the native export of the Worker's traces. **Built:** this page and
   `infra/honeycomb/` (not yet in CI: `infra/README.md`).
2. The route, its limits and its email blanking.
3. The page's SDK, `session.id`, the preference, `traced()` around a sync, baseline attributes.
4. `setlist.open` and `leave`, the attributes on other work, the identity ids and the Support ID in
   the app, error recording, the live-latency measurement, the privacy text (in or before the release
   of step 3).

## Open questions

- `[observability.traces]` as above, and whether the native export honours an incoming `traceparent`.
- Where the account and team ids live in the synced data, and how the sync engine merges a new small file.
- Whether `live-relay.ts` relays `changed` as it came or parses it (`relayedAt` needs it to parse).
- Honeycomb's limits on columns per dataset and event size: attribute names are no longer a fixed list, so junk names from a non-browser sender could fill a dataset's columns.
- Whether Honeycomb bills span events like spans (the sync's slow-request events are capped for that).
