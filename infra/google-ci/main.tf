# How CI's Terraform jobs sign in to Google (docs/CI.md, infra/README.md): Workload Identity
# Federation. GitHub gives each job a short-lived OIDC token; Google trades it for an access token
# of a service account, if the token is from this repository's `infra` or `infra-apply` environment
# (which only run on main). Nothing is stored anywhere, so there is nothing to leak or rotate.
#   ci-plan   (environment `infra`)        reads both projects: plans and the drift check
#   ci-apply  (environment `infra-apply`)  changes what google-chordless and google-dev hold, no more
#
# THIS STACK IS NEVER IN CI: planned and applied by hand (`gcloud auth login`), so a change to the
# code CI runs can never widen what CI may do. The first apply is the bootstrap for the rest.
# It holds only this: the APIs the federation needs (the project's other APIs are google-chordless's).
terraform {
  required_version = ">= 1.10"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
  # State: in R2 (infra/README.md), with AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from an R2 token
  backend "s3" {
    bucket                      = "chordless-tfstate"
    key                         = "google-ci/terraform.tfstate"
    region                      = "auto"
    endpoints                   = { s3 = "https://589e207ea16d7e9db96c2b3d2ae87833.r2.cloudflarestorage.com" }
    use_lockfile                = true
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}

# Auth: `gcloud auth application-default login`, or GOOGLE_OAUTH_ACCESS_TOKEN.
provider "google" {
  project = local.project
}

locals {
  project = "chordless-app"
  # The projects CI's stacks manage
  projects = ["chordless-app", "chordless-dev"]

  # The repository, by its numeric ids, which survive a rename (gh api repos/bloodearnest/chordless)
  repository_id = "1102096624"
  owner_id      = "1042"

  # What each service account may do. Both can read the projects; the apply one can also enable the
  # APIs and manage the API keys of both, and the service account of the app project. Not the
  # project itself, nor IAM: a change to either is made by hand.
  grants = {
    plan = {
      "roles/viewer"                     = local.projects
      "roles/serviceusage.apiKeysViewer" = local.projects
    }
    apply = {
      "roles/viewer"                         = local.projects
      "roles/serviceusage.apiKeysViewer"     = local.projects
      "roles/serviceusage.apiKeysAdmin"      = local.projects
      "roles/serviceusage.serviceUsageAdmin" = local.projects
      "roles/iam.serviceAccountAdmin"        = [local.project]
    }
  }

  # (role, project) pairs of each account, flat for for_each
  bindings = merge([
    for account, roles in local.grants : {
      for pair in flatten([for role, projects in roles : [for project in projects : { role = role, project = project }]]) :
      "${account}/${pair.role}/${pair.project}" => merge(pair, { account = account })
    }
  ]...)
}

# What the federation itself calls. The caller's project (the service account's) is the one whose
# APIs Terraform's calls use, so these are on chordless-app even for chordless-dev's resources.
resource "google_project_service" "ci" {
  for_each = toset([
    "sts.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
  ])
  project            = local.project
  service            = each.key
  disable_on_destroy = false
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = local.project
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"

  depends_on = [google_project_service.ci]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = local.project
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.environment" = "assertion.environment"
  }
  # Only this repository's jobs on main, whatever else is asked of the pool
  attribute_condition = "assertion.repository_id == '${local.repository_id}' && assertion.repository_owner_id == '${local.owner_id}' && assertion.ref == 'refs/heads/main'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "ci" {
  for_each     = toset(["plan", "apply"])
  project      = local.project
  account_id   = "ci-${each.key}"
  display_name = "CI Terraform (${each.key})"
  description  = "Signed in to by GitHub Actions through Workload Identity Federation (infra/google-ci)"

  depends_on = [google_project_service.ci]
}

# The plan account is for jobs of the `infra` environment, the apply one for `infra-apply`'s (which
# waits for the owner's approval)
resource "google_service_account_iam_member" "federation" {
  for_each = {
    plan  = "infra"
    apply = "infra-apply"
  }
  service_account_id = google_service_account.ci[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment/${each.value}"
}

resource "google_project_iam_member" "ci" {
  for_each = local.bindings
  project  = each.value.project
  role     = each.value.role
  member   = google_service_account.ci[each.value.account].member
}

# For scripts/ci/google-auth.sh, which scripts/ci ties to these (no third-party action is allowed)
output "workload_identity_provider" {
  description = "The audience the OIDC token is asked for, and the provider the token is traded at."
  value       = "//iam.googleapis.com/${google_iam_workload_identity_pool_provider.github.name}"
}

output "plan_service_account" {
  value = google_service_account.ci["plan"].email
}

output "apply_service_account" {
  value = google_service_account.ci["apply"].email
}
