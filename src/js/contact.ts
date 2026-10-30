/**
 * Getting in touch: the address, what to say about this device (so that we need not ask), and the
 * link that starts the email. There is no contact form on a server yet (docs/OBSERVABILITY.md,
 * Identity): the page makes an email, which carries the Support ID and the device with it.
 */
import type { DeviceDetails } from './telemetry/device.ts'

export const CONTACT_ADDRESS = 'bloodearnest@gmail.com'

/** What is known about this device and this copy of the app */
export interface SupportInfo {
  /** Empty while usage reports are off: there is no id to give */
  supportId: string
  version: string
  device: DeviceDetails
  online: boolean
  userAgent: string
}

/** The lines that go under the message: plain text, so any mail app keeps them as they are */
export function supportDetails(info: SupportInfo): string {
  const { device } = info
  const browser = device.brands?.length ? device.brands.join(', ') : 'not said by this browser'
  return [
    `Support ID: ${info.supportId || 'none (usage reports are off)'}`,
    `Version: ${info.version || 'unknown'}`,
    `Device: ${device.deviceClass}, ${device.pointer} pointer, ${device.touchPoints} touch points`,
    `Screen: ${device.screen} at ${device.pixelRatio}x, window ${device.viewport}`,
    `Browser: ${browser}${device.platform ? ` on ${device.platform}` : ''}`,
    `Opened as: ${device.displayMode === 'standalone' ? 'an installed app' : 'a web page'}, ${info.online ? 'online' : 'offline'}`,
    `User agent: ${info.userAgent}`,
  ].join('\n')
}

/** The whole message: what the person wrote, and the details under a line */
export function emailBody(message: string, details: string): string {
  const written = message.trim()
  return `${written ? `${written}\n\n` : ''}--\nDetails from Chordless, to help with this:\n${details}\n`
}

/**
 * The link that starts the email. mailto: where there is a share sheet (phones and tablets have a
 * mail app); Gmail's compose window elsewhere, because a desktop with no mail app set up does
 * nothing with mailto: (the same choice the setlist's share makes).
 */
export function emailLink(subject: string, body: string, canShare: boolean): string {
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  return canShare
    ? `mailto:${CONTACT_ADDRESS}?${query}`
    : `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(CONTACT_ADDRESS)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
