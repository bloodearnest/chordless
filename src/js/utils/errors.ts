/** The message of whatever was thrown (anything can be: not only Errors) */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
