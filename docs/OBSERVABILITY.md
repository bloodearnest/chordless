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
| `chordless.sync.run` | `SyncOrchestrator.#execute` | operation, **trigger**, space kind, pulled and pushed counts, pull and push ms, Drive and Worker call counts, total and max Drive ms, error count, outcome. Each Drive and Worker call is a child span, `chordless.drive.request` or `chordless.worker.request` (below) |
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

Every network call through `timedFetch` (the page's Drive API, `callWorker`, the token refresh) is a
`CLIENT` span of its own, `chordless.drive.request` or `chordless.worker.request`, with the method,
`server.address`, `url.path`, `url.query` (the first 300 characters: what a Drive listing asked for says why it was made) and `http.response.status_code`: across a boundary there has
to be a span, for the other side's to be its child. It is a child of the sync running, or of the span
it was given (the token refresh), else a trace of its own. A call to **our Worker** carries that call
span's own `traceparent`, so the Worker's span can be its child; never to Google (a CORS preflight, and
trace ids leaked to a third party). A failure is a call with no answer, a 429, or any 4xx but 404
(Drive's way of saying there is no such file). At most 200 calls of one sync are spans: a first
sync can make hundreds, and the totals on the sync's span count them all.

**The Worker's spans do not join.** Cloudflare's native export ignores an incoming `traceparent`: the
Worker's `/session/refresh` span is a root in a trace of its own (checked 2026-10-28). So the page's
call span carries the response's `cf-ray` as `cloudflare.ray_id`, the same value as on the Worker's span
(in the `chordless` dataset): find one from the other by the ray id. The `traceparent` header is still
sent, in case Cloudflare honours it one day. There is no setting for it (checked 2026-10-28: the
zone-level "incoming trace context" option of Cloudflare Traces is not in the dashboard for a Worker,
and Cloudflare's own support says it is a platform gap they are working on); the request to follow is
https://github.com/cloudflare/workers-sdk/discussions/11062. A custom span in the Worker cannot take
the caller's trace id either: parent-child wiring is automatic only.

**So the Worker makes its own span** (`worker/src/trace.ts`, `chordless.worker.handle`, service
`chordless-worker`, its own dataset). For a request that carries a valid, sampled `traceparent` (only the
page's calls to the Worker do), it takes the caller's trace id and its span id as parent, and sends one
span (made with the OTel SDK) to the same destination as the page's traces, after the response, in `waitUntil`: it
never changes the answer, and is not made without a destination or from a sender over the `TELEMETRY`
limit. Attributes: method, `http.route` (the path with its ids as `:id`), status, `server.address`,
`user_agent.original`, `cloudflare.ray_id`, from `request.cf` the colo, ASN and where it came from (country,
continent, region, city, timezone), the Worker's version (the `[version_metadata]` binding, also
`service.version`), and `chordless.outcome`. Not available to us: `cpu_time_ms`, time to first byte and the
spans of bindings (Durable Objects, the rate limiter, subrequests), which only Cloudflare's native
export has. So the native export stays on for now, until a few days of both show whether it is missed;
then it is one line in `wrangler.toml` to turn off.

**The Worker's calls are spans below it** (`tracedFetch` and `tracedStub` in `trace.ts`). The Worker has
async context (`AsyncLocalStorage`, from `nodejs_compat`; the OTel context manager is
`@opentelemetry/context-async-hooks`), so `chordless.worker.handle` is the active span while the request
runs and what it awaits is below it, with no explicit parenting. `tracedFetch` wraps the Drive calls of a
team space, a share's download and the token endpoint: `chordless.worker.fetch`, with the method, host,
path (never the query) and status, ended when the response's headers arrive; the body is never read or
cloned, so a stream goes through as it was. `tracedStub` wraps a Durable Object's stub:
`chordless.worker.do`, with the method and class, ended when the call is answered.

**The standard HTTP attributes** are on the Worker's span and on the call spans, page and Worker, wherever
the value is known without reading a body: `http.request.method`, `http.route` (the Worker's), `url.path`,
`url.scheme`, `server.address`, `server.port`, `http.response.status_code`, `error.type` (the status of a
failure, or the error's class; `_OTHER` for something thrown that is not an Error), and on the Worker's span
`network.protocol.name` and `.version` (from `request.cf.httpProtocol`) and `user_agent.original`. The sizes,
`http.request.body.size` and `http.response.body.size`, come from `Content-Length` or from a body held in
memory (a string, bytes, a Blob); a streamed or chunked body has no size, and is not read or counted to
find one (wrapping a stream in JavaScript costs CPU, which the pad audio passing through would pay). So a
response's size is often missing on the Worker's side, and the sizes are the bytes on the wire when the body is compressed. Left
out: `client.address` (an IP address), the request and response headers (opt-in in the conventions, and
their names have hyphens, which the telemetry route drops), `url.query` on the Worker's side (the page's call
spans keep a truncated one), `http.request.method_original` and the TLS attributes.

**The page knows the size of the answers it gets from the Worker.** A call to our Worker is to the page's
own address, so the browser's resource entry for it (`PerformanceResourceTiming`) has the sizes of the
answer even when it is streamed or chunked: `http.response.body.size` (the bytes on the wire, as
compressed), `chordless.http.response.decoded_body_size` (what they came to) and `http.response.size`
(with the headers; none from the cache). The entry exists once the whole body is in, so the call's span
waits for it, up to 300 ms, polling, and then ends as of the moment it was answered (so its duration is
unchanged); if no entry comes (a body nobody reads) it ends without the sizes. Drive's calls are
cross-origin, whose entries have no sizes without a `Timing-Allow-Origin`, so they keep the `Content-Length`
only. No trace context
is sent on, to Google or to the objects. At most 50 calls of a request are spans. No existing OTel fetch
instrumentation fits: `instrumentation-fetch` clones and reads the whole response (a stream would be
buffered in memory: Drive and pad audio go through here), `instrumentation-undici` and `-http` hook
Node's own clients, which workerd does not have, and `otel-cf-workers` is an older release candidate that
pins the 2.x packages and wants to wrap the whole Worker.

**Steps of a sync.** `phase()` (`telemetry.ts`) makes a step of the sync running a span of its own, the
parent of the calls it makes, so a trace says which step each call belonged to: `chordless.sync.init`,
`.feed`, `.feed_position`, `.members`, `.access`, `.inventory`, `.pull`, `.push`. It holds the one
sync's "current span" the same way the calls do, and does nothing outside a sync or in an unsampled
one. A call made while a sync runs but from other code (a pad loading) is still a child of whichever
step is current: the module variable cannot tell them apart. Calls with no sync are root traces.

**What started a sync**, `chordless.sync.trigger`: `manual` (the Sync button on a space's card),
`tick` (the one-minute timer), `resume` (the app opened or came back), `online` (the device came back
online), `edit` (a change made here, 2 s after it), `live` (another device said it changed
something), `other` (anything else: a start over, a reset, a push or pull). The operation says which
sync it was (`Sync`, the full one, or `Incremental sync`); the trigger says why.

**Sampling.** The `tick` syncs are the many (a device left awake on a charger makes 1,440 a day) and
mostly find nothing, so one in ten is reported (`TICK_SAMPLE`, head sampling at the start of the
sync: a sampled sync and its calls carry `SampleRate = 10`, which Honeycomb counts as ten). One that
is not sampled is no span, and its calls are none either. Every other trigger is reported in full.
The cost: an unsampled tick that fails is not reported (its failure is on the console only). A
failure could be reported afterwards as a plain span, if it matters.

Volume (estimated 2026-10-28): the app syncs every minute while on screen, about 3 Drive calls each,
so the call spans make the sync's events about 4 times as many (60 to 240 an hour on screen): about
125,000 events a month for 6 weekly users on two devices each, against 20 million on Honeycomb's
free tier. The totals stay on the sync span for the day the call spans are sampled.

The browser has no async context: there is no `AsyncLocalStorage`, and the default context manager
loses the *active* span across `await` (the TC39 AsyncContext proposal is not available). A span can
live across any number of awaits, but a span or auto-instrumented fetch started after one has no
implicit parent and becomes a root. zone.js is the usual answer and cannot follow native
`async`/`await` (it needs code down-compiled to ES2015, against our Safari 17.4 floor). So parents are
passed explicitly where we want children: the follow-up fetches of a live update (five at most) are
child spans of `chordless.live.receive`, which we hold in a variable. The calls of a sync are children
of it by the same means: the sync runs one at a time, under a lock, so its span is a module variable
that `timedFetch` reads (`telemetry.ts`).

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
  `chordless.sync.drive_calls`, `drive_ms_total`, `drive_ms_max`, `worker_calls`, `errors`. Each call
  is also a span (see Context propagation). Only one sync runs at a time (the sync lock), so the one
  "tracked" span is a module variable, not async context.
- Spans made so far: `chordless.sync.run` (`SyncOrchestrator`), `chordless.auth.refresh` (a span of its
  own, not an attribute: how long the Worker took is its duration, and a sign-in that has expired
  is its error), and `chordless.error` (an unhandled error, an unhandled rejection, or a `toast()` error:
  at most 20 a visit). No auto-instrumentation (`instrumentation-fetch`, document-load, interaction):
  the call spans are our own wrapper, so that they are the calls we choose.
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
of the same one), `.transposes` and `.edit_entries`, and two that tell whether changes were lost:
`.left` (`page` when the page went, as the tab closed or the app was put away; `navigation` when the
app moved to another page and carries on) and `.unsent_on_leave` (whether changes made in this tab
had not reached the storage yet: `AutoSync.hasUnsent`, which counts a save waiting for the quiet, one
in the sync running, and one a sync left behind). `unsent_on_leave` with `left = page` is the
sync-on-close problem (TODO), and the way to see how often it happens; with `navigation` it is just a
moment's wait. It sees this tab's edits only: what an earlier visit left is the next sync's to find.
The song in view is only counted, for those totals: no span carries it. The `pagehide` listener is a capturing one, so the leave span is made before the SDK's own flush on pagehide sends it.
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
