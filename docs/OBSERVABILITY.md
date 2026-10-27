# Observability

Traces from the page and the Worker go to Honeycomb (OpenTelemetry, OTLP), so that before and after
going live we can see what the app does in the field: sync failures, slow Drive calls, auth
refreshes, how a setlist session goes, how long a live update takes to reach a follower. Honeycomb's
environments and keys are Terraform (`infra/honeycomb/`); the Worker's secret is wrangler's, as ever
(`infra/README.md`).

**Status:** designed, being built in steps (below). Nothing on this page is in the app yet except
what the "Built" notes say.

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
- **No song content, ever, in a span.** Setlist uuids, service dates and CCLI numbers are fine; titles,
  lyrics, charts and share-link keys are not. The Worker route enforces it with an allow-list.
- Chordless stores no copyrighted content (CLAUDE.md): the route parses a small body in memory and
  forwards it. Nothing is written to KV, R2, a Durable Object or the cache.

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
in a setlist, `session.id`, `chordless.setlist.id` and `chordless.setlist.date`; for the current
song, `chordless.song.id`, `.ccli`, `.index` and `.key` (the displayed key, never the title); and
`chordless.route` (the template, not the URL), `chordless.live`, `chordless.online`,
`chordless.display_mode`. Resource attributes: `service.name` (`chordless-web`), `service.version`,
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

`worker/src/telemetry.ts`, `POST /api/otlp/v1/traces`. It is the small collector: authentication and
abuse limits, redaction, forwarding.

- Same origin only (`isCrossOrigin`, `Sec-Fetch-Site: same-origin` for a beacon); `application/json`
  only; a body size cap; a rate-limit binding by IP (`TELEMETRY`, repeated in `[env.dev]`).
- **Redaction:** the capped body is parsed in memory and only allow-listed attribute keys are kept
  (the `chordless.*` names here and the standard ones above), with caps on value length and the
  number of attributes. A bug in the page cannot ship a title or a lyric. Never stored, never logged.
  The sample-rate attribute is on the list from the start (see "If volume grows").
- Forwards to `OTLP_ENDPOINT` with `OTLP_HEADERS`. No secret set (local development): it accepts and
  drops.
- Always answers 204, whatever upstream says.

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

The `destinations` key is as Cloudflare's examples show it, but the page on tracing does not. Wrangler's
dry-run (`scripts/lint-wrangler.sh`) accepts the block without a warning, but that does not check
that the destination exists, so a first deploy is the test. Do not add the block before the
destination exists (it is not in `wrangler.toml` yet). `persist = false` matters:
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

## Steps

1. This page; `infra/honeycomb/`; the native export of the Worker's traces. **Built:** this page and
   `infra/honeycomb/` (not yet in CI: `infra/README.md`).
2. The route, its limits and its allow-list.
3. The page's SDK, `session.id`, the preference, `traced()` around a sync, baseline attributes.
4. `setlist.open` and `leave`, the attributes on other work, the identity ids and the Support ID in
   the app, error recording, the live-latency measurement, the privacy text (in or before the release
   of step 3).

## Open questions

- `[observability.traces]` as above, and whether the native export honours an incoming `traceparent`.
- Where the account and team ids live in the synced data, and how the sync engine merges a new small file.
- Whether `live-relay.ts` relays `changed` as it came or parses it (`relayedAt` needs it to parse).
- Honeycomb's limits on columns per dataset and event size, to size the allow-list.
- Whether Honeycomb bills span events like spans (the sync's slow-request events are capped for that).
