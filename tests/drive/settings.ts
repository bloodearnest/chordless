/** What a run of the real-Drive suite was asked for (read from the environment by node-side.ts) */
export interface DriveSuiteSettings {
  seeds: number[]
  steps: number
  devices: number
  modes: string[]
}
