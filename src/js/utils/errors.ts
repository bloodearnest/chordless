/** The message of whatever was thrown (anything can be: not only Errors) */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * An error whose message is written for the person who may read it (docs/COPY.md, "Errors"): a
 * message of the catalogue, `new UserError(t('…'))`. Any other error is for a developer: what it
 * says is kept for the console and the reports, and the person is told what failed in words.
 */
export class UserError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'UserError'
  }

  /** Whether the message is for the person (a subclass may say it is not, as the Worker's server errors) */
  get forPeople(): boolean {
    return true
  }
}

/** Whether what an error says was written for the person who sees it */
export function isForPeople(error: unknown): boolean {
  return error instanceof UserError && error.forPeople
}

/**
 * What to show a person of an error: its own message where that is written for them, and otherwise
 * `what`, a message of the catalogue that says what could not be done ("Couldn't save the licence
 * number."). The error itself is logged, with the reports' telemetry, so nothing is lost.
 */
export function whatToSay(error: unknown, what: string): string {
  if (isForPeople(error)) return errorMessage(error)
  console.warn(`[Error] ${what}`, error)
  return what
}
