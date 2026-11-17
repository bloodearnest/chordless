/**
 * A message with a link, bold or emphasis in the middle of its sentence (docs/COPY.md): the message
 * marks the words with a tag, and the code says what each tag is.
 *
 *   rich('account-drive-hint', undefined, {
 *     connect: words => html`<a href="/account">${words}</a>`,
 *   })
 *
 *   account-drive-hint = Google Drive is not connected. <connect>Connect it</connect> on the Account page.
 *
 * A tag is `<name>words</name>`, one level (no tag inside another), and only the names the code gives
 * are tags: any other `<…>` is the words it is. Values given to the message are never read as tags, so
 * a space called `<b>` is shown as that.
 */
import { html, type TemplateResult } from 'lit'
import { type TextArgs, t } from './text.ts'

/** What each tag becomes, from the words inside it */
export type RichTags = Record<string, (words: string) => TemplateResult>

/** Stands for "<" in a value while the message is read for its tags */
const LESS_THAN = ''

const TAG = /<([a-z][a-z0-9-]*)>([^<]*)<\/\1>/g

/** The message, as the pieces to put in a template: text, and what each tag made */
export function rich(
  key: string,
  args: TextArgs | undefined,
  tags: RichTags
): Array<string | TemplateResult> {
  const guarded =
    args && Object.fromEntries(Object.entries(args).map(([name, value]) => [name, guard(value)]))
  const text = t(key, guarded)
  const pieces: Array<string | TemplateResult> = []
  let from = 0
  for (const match of text.matchAll(TAG)) {
    const [whole, name, words] = match as unknown as [string, string, string]
    const make = tags[name]
    if (match.index > from) pieces.push(unguard(text.slice(from, match.index)))
    pieces.push(make ? make(unguard(words)) : unguard(words))
    from = match.index + whole.length
  }
  if (from < text.length) pieces.push(unguard(text.slice(from)))
  return pieces.length ? pieces : [html``]
}

function guard<T>(value: T): T | string {
  return typeof value === 'string' ? value.replaceAll('<', LESS_THAN) : value
}

function unguard(text: string): string {
  return text.replaceAll(LESS_THAN, '<')
}
