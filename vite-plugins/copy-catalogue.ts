import { type Message, parse } from '@fluent/syntax'

/**
 * Reading and changing the catalogue of what the app says (src/text/en.ts), for the dev editor
 * (copy-editor.ts) and the test of the catalogue. The file is Fluent in a template literal; a message
 * is changed in the text of the file, leaving everything around it as it was, so that an edit is a
 * one-message diff.
 */

const OPEN = 'String.raw`'

export interface CopyMessage {
  id: string
  /** The comment above it: what it is for, and what its values are */
  comment: string
  /** What it says, as it is in the file: `{ $name }` and all */
  source: string
}

/** Where the Fluent is in the module: between the backticks of its `String.raw` literal */
function bounds(module: string): { start: number; end: number } {
  const open = module.indexOf(OPEN)
  const close = module.lastIndexOf('`')
  if (open === -1 || close <= open) throw new Error('The catalogue has no String.raw literal')
  return { start: open + OPEN.length, end: close }
}

/** The Fluent in the catalogue module */
export function fluentOf(module: string): string {
  const { start, end } = bounds(module)
  return module.slice(start, end)
}

/** Without the indent the lines of a message have in the file */
function dedent(text: string): string {
  const lines = text.split('\n')
  const indents = lines.filter(line => line.trim()).map(line => /^ */.exec(line)?.[0].length ?? 0)
  const common = indents.length ? Math.min(...indents) : 0
  return lines
    .map(line => line.slice(common))
    .join('\n')
    .trim()
}

function messagesOf(fluent: string): Message[] {
  return parse(fluent, {}).body.filter(entry => entry.type === 'Message')
}

/** Every message in the module, in the order of the file */
export function listMessages(module: string): CopyMessage[] {
  const fluent = fluentOf(module)
  return messagesOf(fluent)
    .filter(message => message.value?.span)
    .map(message => ({
      id: message.id.name,
      comment: message.comment?.content ?? '',
      source: dedent(fluent.slice(message.value?.span?.start, message.value?.span?.end)),
    }))
}

/** What is wrong with Fluent as a catalogue's, or null: a message that does not parse is left out of the app */
export function problemWith(fluent: string): string | null {
  const junk = parse(fluent, {}).body.find(entry => entry.type === 'Junk')
  if (!junk) return null
  const note = junk.annotations[0]
  return note ? `${note.message} (${note.code})` : 'Not valid Fluent'
}

/**
 * The module with one message saying `source` instead, and nothing else changed. Throws, with what
 * to tell the person, when there is no such message or the result would not be valid Fluent.
 */
export function replaceMessage(module: string, id: string, source: string): string {
  if (/`|\$\{/.test(source)) {
    throw new Error(
      'A message cannot have a backtick or "${" in it: the file is a template literal.'
    )
  }
  const text = source.trim()
  if (!text) throw new Error('A message cannot be empty.')
  const { start, end } = bounds(module)
  const fluent = module.slice(start, end)
  const message = messagesOf(fluent).find(each => each.id.name === id)
  if (!message?.value?.span || !message.id.span) throw new Error(`There is no message "${id}".`)

  const lines = text.split('\n')
  const value =
    lines.length === 1
      ? ` = ${text}`
      : ` =\n${lines.map(line => (line.trim() ? `    ${line}` : '')).join('\n')}`
  const next = fluent.slice(0, message.id.span.end) + value + fluent.slice(message.value.span.end)

  const problem = problemWith(next)
  if (problem) throw new Error(problem)
  const again = messagesOf(next).find(each => each.id.name === id)
  if (!again?.value) throw new Error('That did not make a message.')
  return module.slice(0, start) + next + module.slice(end)
}
