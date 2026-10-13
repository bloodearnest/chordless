# Email import

A leader emails the band a setlist: a list of songs in the body and a chart for each as a PDF.
Chordless makes a setlist from it. Two ways in, one review page.

## The flow

1. **Forward the email** to the import address (the Worker below), or pick an `.eml` file on
   the Import a Setlist page (`/import-setlist`).
2. The email is read: the leader (the innermost forwarded sender), the date, the songs in order
   with keys and notes, and each PDF's title, key, tempo and CCLI number
   (`src/js/email-setlist.ts`, `email-mime.ts`, `pdf-text.ts`).
3. With the Worker, the reply holds a link, `/import-setlist#<the setlist>`. The setlist is
   deflated and base64url'd into the fragment (`src/js/email-link.ts`). A fragment is never sent to a
   server, and the page checks it as untrusted: every field is validated and cut down.
4. The review page (`src/components/setlist-email-import.ts`) matches each song to the library
   (`src/js/import-plan.ts`): CCLI number, then title, then close titles, then a line of a song's
   words, the last two for the person to confirm. A song the library lacks links to SongSelect
   (`src/js/songselect-link.ts`) and must be imported with the bookmarklet first, or left out.
   Then **Create setlist**.

**PDFs are never imported as charts**, and no placeholder songs are made. They are read for
metadata only, and the Worker keeps nothing.

## The Worker (`worker/src/email.ts`, `email()` in `worker/src/index.ts`)

Reads the raw email in memory, answers the sender with the link (or why there is none), and stores
nothing. The reply goes only to the envelope sender, threaded on their `Message-ID`. Emails over
25 MB are ignored. The link's origin is `APP_ORIGIN`, `https://chordless.app` when unset.

### Setting it up (once, in the Cloudflare dashboard)

Email Routing is on the domain, not in `wrangler.toml`:

1. Cloudflare dashboard › chordless.app › Email › Email Routing: enable it (it adds the MX and
   SPF records).
2. Routing rules › Create address: a custom address (for example `import@chordless.app`) with the
   action **Send to a Worker** › `chordless`.
3. Deploy the Worker as usual.

The address is public: anyone who knows it can email it and get a reply to the address they
sent from. The reply is short and only goes to the sender, but abuse (someone forging a sender) is
possible; if it becomes a problem, rate limit it or reply only to senders with a passing DKIM/SPF.

### Trying it locally

```
npx vite build
npx wrangler dev --config dist/chordless/wrangler.json
curl -X POST "http://localhost:8787/cdn-cgi/handler/email?from=you@example.com&to=import@chordless.app" \
  --data-binary @some.eml
```

The `.eml` needs a `Message-ID` header. The reply is written under `dist/chordless/.wrangler/`.

## Privacy

The link holds titles, keys, CCLI numbers, the date, and the leader's name and email: never a PDF,
the body, or the `To:`/`Cc:` lists. `public/privacy.html` says so.
