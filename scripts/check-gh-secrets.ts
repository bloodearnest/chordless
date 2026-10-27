// The GitHub environments have the secrets the workflows use (docs/CI.md), by name: the values are
// set by hand (gh secret set NAME --env ENV) or by scripts/ci-tokens.sh, never by Terraform, so this
// is what checks them. `just check-gh-secrets`; needs a gh login with admin on the repository.
import { execFileSync } from 'node:child_process'

const REPOSITORY = 'bloodearnest/chordless'

const terraform = (access: string) => ({
  AWS_ACCESS_KEY_ID: `the R2 token (${access}) for the Terraform state: scripts/ci-tokens.sh makes it`,
  AWS_SECRET_ACCESS_KEY: 'its secret, which scripts/ci-tokens.sh sets with it',
  GH_TERRAFORM_TOKEN: `a fine-grained token, this repository only: Administration and Environments, ${access} (infra/README.md)`,
})

const NEEDED: Record<string, Record<string, string>> = {
  infra: terraform('read'),
  'infra-apply': terraform('read and write'),
  production: {
    CLOUDFLARE_API_TOKEN:
      'an account API token for deploys: Workers Scripts: Edit, this account only (infra/README.md)',
  },
}

// Variables that are not secrets, by environment (the R2 tokens' expiry is each Terraform one's)
const VARIABLES: Record<string, string> = {
  infra: 'R2_TOKEN_EXPIRES',
  'infra-apply': 'R2_TOKEN_EXPIRES',
  production: 'CLOUDFLARE_ACCOUNT_ID',
}

const listed = (environment: string, kind: 'secrets' | 'variables') =>
  JSON.parse(
    execFileSync(
      'gh',
      [
        'api',
        `repos/${REPOSITORY}/environments/${environment}/${kind}`,
        '--jq',
        `[.${kind}[].name]`,
      ],
      { encoding: 'utf8' }
    )
  ) as string[]

let missing = 0
for (const [environment, secrets] of Object.entries(NEEDED)) {
  const names = listed(environment, 'secrets')
  for (const [name, about] of Object.entries(secrets)) {
    if (names.includes(name)) continue
    console.error(`${environment} lacks ${name}: ${about}`)
    missing++
  }
  if (!listed(environment, 'variables').includes(VARIABLES[environment])) {
    console.error(`${environment} lacks the variable ${VARIABLES[environment]} (infra/README.md)`)
    missing++
  }
}
if (missing > 0) process.exit(1)
console.log('The GitHub environments have all the secrets the workflows use.')
