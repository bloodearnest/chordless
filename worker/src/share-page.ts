/**
 * What /s/<id> says to the crawlers and chat apps that fetch a share link to preview it. They
 * don't run the app, and the setlist is encrypted, so all they can be told is that a setlist
 * was shared. The page also asks not to be indexed.
 */

const TITLE = 'A setlist shared with you'
const DESCRIPTION = 'Open the link to see the songs and chords. No account needed.'

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)

/** The index page with the preview tags in its head (and its generic title and description replaced) */
export function withSharePreview(html: string, origin: string): string {
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Chordless" />`,
    `<meta property="og:title" content="${escapeHtml(TITLE)}" />`,
    `<meta property="og:description" content="${escapeHtml(DESCRIPTION)}" />`,
    `<meta property="og:image" content="${escapeHtml(`${origin}/icons/icon-512.png`)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="robots" content="noindex, nofollow" />`,
  ].join('\n    ')
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(TITLE)} - Chordless</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${escapeHtml(DESCRIPTION)}" />`
    )
    .replace('</head>', `    ${tags}\n  </head>`)
}
