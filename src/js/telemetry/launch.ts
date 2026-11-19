/**
 * The report of a launch (docs/OBSERVABILITY.md, `chordless.storage.launch`): whether what the app
 * keeps on the device (src/js/storage-survival.ts) was there when it started. Made once the SDK has
 * started, so one for each page load while reports are on.
 */
import type { Attributes } from '@opentelemetry/api'
import { getBlob } from '../auth-db.ts'
import { type LaunchReport, launchReport } from '../storage-survival.ts'
import { recordSpan } from './telemetry.ts'

/** Whether the sign-in's record is in the device's storage; null where it cannot be read */
async function signedInRecord(): Promise<boolean | null> {
  try {
    return (await getBlob()) !== undefined
  } catch {
    return null
  }
}

/** The span's attributes for a launch: only counts, times and yes or no (never anything of the person's) */
export function launchAttributes(
  report: LaunchReport,
  signedIn: boolean | null,
  now: Date = new Date()
): Attributes {
  const attributes: Attributes = {
    'chordless.storage.local': report.localStorage,
    'chordless.storage.indexeddb': report.indexedDb,
    'chordless.storage.launches': report.launches,
    'chordless.storage.first_seen_days': Math.floor(
      (now.getTime() - Date.parse(report.firstSeen)) / 86_400_000
    ),
    // Neither store remembered an earlier launch: the first launch, or everything was cleared (a
    // device that does it at every launch shows this on all its reports, each with a new device id)
    'chordless.storage.fresh': report.launches === 1,
    'chordless.storage.controlled': report.controlled,
  }
  if (report.previous) {
    attributes['chordless.storage.previous_s'] = Math.round(
      (now.getTime() - Date.parse(report.previous)) / 1000
    )
  }
  if (report.persisted !== null) attributes['chordless.storage.persisted'] = report.persisted
  if (report.caches !== null) attributes['chordless.storage.caches'] = report.caches
  if (signedIn !== null) attributes['chordless.storage.signed_in_record'] = signedIn
  return attributes
}

/** Send this launch's report (once the SDK is started) */
export async function reportLaunch(): Promise<void> {
  const [report, signedIn] = await Promise.all([launchReport(), signedInRecord()])
  recordSpan('chordless.storage.launch', launchAttributes(report, signedIn))
}
