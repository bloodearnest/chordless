# Analytics (a plan, not built)

The TODO has the one-line item. Usage reports of how the app behaves are separate and built: docs/OBSERVABILITY.md.

privacy-preserving analytics (cookieless, like Plausible; GoatCounter, Umami and Cloudflare Web
Analytics are the alternatives). Proxy the script and its event endpoint through the worker so
the CSP stays 'self' and ad blockers don't drop it. Constraints: events are lost while the
device is offline (the iPad often is), so counts undercount; never send song titles, lyrics,
setlist names or the ids in /setlist/<id> and /songs/<id> (count the page type only); never send
Google sign-in data (email, name, id): the OAuth verification is for Limited Use; no events in
dev or the Playwright tests; update src/privacy.html (it says no analytics) in the same
change.
Song popularity: one event when a song is added to a setlist, with its CCLI song number as a
property (a public catalogue id, not user data), only when it is all digits (4 to 9 long), so
free text can never leak. Never fall back to the title (it may be a private song). Songs with no
CCLI number are not counted. The chart's number is in song.metadata.ccliSongNumber or .ccli (getSongWithContent). Plausible custom props: check which plan; GoatCounter can use an event
name like song-added/<number>; Cloudflare Web Analytics has no events. Say it in the policy too
