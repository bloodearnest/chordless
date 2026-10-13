/**
 * Downloads emails with PDFs attached from Gmail as .eml files, to try the email importer on
 * (docs/TESTING.md, "Real emails"). They go in tests/fixtures/private/emails/, which git ignores:
 * the charts are copyrighted, and the emails have other people's addresses in them.
 *
 *   GMAIL_TOKEN=ya29... node scripts/download-emails.ts --from a@example.com,b@example.com
 *   GMAIL_TOKEN=ya29... node scripts/download-emails.ts --senders-file senders.txt --after 2025/01/01
 *
 * Options:
 *   --from a,b           Addresses to take mail from (comma separated)
 *   --senders-file path  One address per line (# starts a comment); adds to --from
 *   --min-pdfs 3         Keep emails with at least this many PDFs (default 3)
 *   --after YYYY/MM/DD   Only emails after this date
 *   --max N              Look at no more than N emails from the search
 *   --out dir            Where to save (default tests/fixtures/private/emails)
 *   --dry-run            Say what would be saved, and save nothing
 *
 * The token goes in the environment, not an argument, so it is not left in your shell history.
 * See docs/TESTING.md for how to get one. Emails already in the folder are skipped, so it can be
 * run again to fetch new ones.
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { downloadEmails } from './gmail-download.ts'

const { values } = parseArgs({
  options: {
    from: { type: 'string' },
    'senders-file': { type: 'string' },
    'min-pdfs': { type: 'string', default: '3' },
    after: { type: 'string' },
    max: { type: 'string' },
    out: { type: 'string', default: 'tests/fixtures/private/emails' },
    'dry-run': { type: 'boolean', default: false },
  },
})

const token = process.env.GMAIL_TOKEN
if (!token) {
  console.error(
    'Set GMAIL_TOKEN to an access token with the gmail.readonly scope (docs/TESTING.md).'
  )
  process.exit(1)
}

const senders = [
  ...(values.from ?? '').split(','),
  ...(values['senders-file'] ? readFileSync(values['senders-file'], 'utf8').split(/\r?\n/) : []),
]
  .map(line => line.replace(/#.*/, '').trim())
  .filter(Boolean)

try {
  await downloadEmails({
    token,
    senders,
    minPdfs: Number(values['min-pdfs']),
    after: values.after,
    max: values.max ? Number(values.max) : undefined,
    outDir: values.out,
    dryRun: values['dry-run'],
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
