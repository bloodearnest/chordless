// Known advisories in the production dependencies (`just audit`, after the signatures; docs/CI.md).
// It fails only on what can be acted on: a high or critical advisory whose fix was released more
// than a week ago. A fix younger than that waits, as Dependabot does (its `cooldown`), and is said
// with the date it becomes due; an advisory with no fix yet is said too. The dev tools' advisories
// are listed, not failed: they never reach users.
import { execFileSync } from 'node:child_process'
import semver from 'semver'

const COOLDOWN_DAYS = 7
const FAILS = new Set(['high', 'critical'])

interface Advisory {
  title: string
  url: string
  severity: string
  range: string
}

interface AuditReport {
  vulnerabilities: Record<string, { via: (string | Advisory)[]; isDirect: boolean }>
}

const npm = (...args: string[]) => {
  try {
    return execFileSync('npm', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    // npm audit exits non-zero when it finds anything; the report is still on stdout
    return (error as { stdout: string }).stdout
  }
}

const audit = (...args: string[]) => JSON.parse(npm('audit', '--json', ...args)) as AuditReport

/** The installed version of a package, from the lockfile */
const installed = (name: string): string | null => {
  const tree = JSON.parse(npm('ls', name, '--json', '--all')) as {
    dependencies?: Record<string, { version?: string; dependencies?: object }>
  }
  const found: string[] = []
  const walk = (deps: Record<string, { version?: string; dependencies?: object }> = {}) => {
    for (const [key, dep] of Object.entries(deps)) {
      if (key === name && dep.version) found.push(dep.version)
      walk(dep.dependencies as typeof deps)
    }
  }
  walk(tree.dependencies)
  return found.sort(semver.compare)[0] ?? null
}

const day = 24 * 60 * 60 * 1000
const due = (released: Date) => new Date(released.getTime() + COOLDOWN_DAYS * day)
const date = (when: Date) => when.toISOString().slice(0, 10)

let failed = false
for (const [name, vulnerability] of Object.entries(audit('--omit=dev').vulnerabilities)) {
  for (const advisory of vulnerability.via) {
    if (typeof advisory === 'string' || !FAILS.has(advisory.severity)) continue
    const current = installed(name)
    const times = JSON.parse(npm('view', name, 'time', '--json')) as Record<string, string>
    // The versions after the one installed that the advisory does not cover, oldest first
    const fixes = Object.keys(times)
      .filter(version => semver.valid(version) && !semver.prerelease(version))
      .filter(version => !current || semver.gt(version, current))
      .filter(version => !semver.satisfies(version, advisory.range))
      .sort(semver.compare)
      .map(version => ({ version, released: new Date(times[version]) }))
    const ready = fixes.find(fix => due(fix.released) <= new Date())
    const about = `${name} ${current ?? '?'}: ${advisory.title} (${advisory.severity}, ${advisory.url})`
    if (ready) {
      console.error(
        `${about}\n  fixed in ${ready.version}, released ${date(ready.released)}: update it`
      )
      failed = true
    } else if (fixes.length > 0) {
      const first = fixes[0]
      console.log(
        `${about}\n  fixed in ${first.version}, released ${date(first.released)}: due after the cooldown, on ${date(due(first.released))}`
      )
    } else {
      console.log(`${about}\n  no fixed version yet`)
    }
  }
}

const dev = Object.entries(audit().vulnerabilities).filter(
  ([name]) => !(name in audit('--omit=dev').vulnerabilities)
)
if (dev.length > 0) {
  console.log(
    `\nThe dev tools' advisories (for information): ${dev.map(([name]) => name).join(', ')}`
  )
}
if (failed) process.exit(1)
console.log('\nNo production dependency has a known high advisory with a fix due.')
