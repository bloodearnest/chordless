/** What the real-Drive tests in the browser ask of the runner's Node side (node-side.ts) */
import { executeServerCommand } from '@web/test-runner-commands'
import type { DriveSuiteSettings } from './settings.ts'

export const driveToken = () => executeServerCommand<string, undefined>('drive-token')

export const driveSettings = () =>
  executeServerCommand<DriveSuiteSettings, undefined>('drive-settings')
