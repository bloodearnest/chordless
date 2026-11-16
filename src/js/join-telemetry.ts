/**
 * What happened on the join page, as one span (docs/OBSERVABILITY.md): the steps the person went through, where
 * they stopped, and how it ended, so that "where do invitees get stuck?" is a query. One span for the visit,
 * ended when they join or hit a dead end, or, as `chordless.setlist.leave` is, when the page is left or
 * closed without either ("abandoned"). OS, browser and device are on it already (baseline.ts); never an
 * address or a name.
 */
import { recordSpan } from './telemetry/telemetry.ts'

export type JoinOutcome = 'joined' | 'bad_link' | 'not_valid' | 'needs_admin_address' | 'abandoned'

type Facts = Record<string, string | number | boolean>

export class JoinTrail {
  #started = performance.now()
  #steps: string[] = []
  #facts: Facts = {}
  #ended = false

  /** The page is now on this step (a repeat of the last is not a new step) */
  step(name: string): void {
    if (this.#steps[this.#steps.length - 1] !== name) this.#steps.push(name)
  }

  /** What is known (kept as given; a later value replaces an earlier one) */
  note(facts: Facts): void {
    Object.assign(this.#facts, facts)
  }

  get ended(): boolean {
    return this.#ended
  }

  /** The visit is over: the span is made, once, and only for a visit that got as far as a step */
  end(outcome: JoinOutcome): void {
    if (this.#ended) return
    this.#ended = true
    if (this.#steps.length === 0) return
    recordSpan('chordless.join', {
      ...this.#facts,
      'chordless.join.outcome': outcome,
      'chordless.join.steps': this.#steps.join(','),
      'chordless.join.last_step': this.#steps[this.#steps.length - 1] ?? '',
      'chordless.join.ms': Math.round(performance.now() - this.#started),
    })
  }
}
