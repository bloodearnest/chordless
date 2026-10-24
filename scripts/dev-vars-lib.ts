// The pure parts of scripts/dev-vars.ts: reading and writing a .dev.vars file, and deciding what
// of an existing one to keep.

/** KEY=value lines (comments and blank lines set aside; quotes taken off) */
export function parseVars(text: string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const found = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (found) vars[found[1]] = found[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return vars
}

/**
 * The example file with the values filled in: its comments and order kept, each `NAME=` given its
 * value. A name with no value is left empty.
 */
export function fillTemplate(template: string, values: Record<string, string | undefined>): string {
  return template.replace(
    /^([A-Z][A-Z0-9_]*)=.*$/gm,
    (_line, name) => `${name}=${values[name] ?? ''}`
  )
}

/** Whether a .dev.vars belongs to another environment than the client this one is for */
export function isOtherEnvironment(existing: Record<string, string>, clientId: string): boolean {
  return Boolean(existing.GOOGLE_CLIENT_ID) && existing.GOOGLE_CLIENT_ID !== clientId
}
