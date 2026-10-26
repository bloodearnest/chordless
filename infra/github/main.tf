# The GitHub repository's settings: how changes reach main, what Actions may run, and the
# environments that hold the deploy's secrets (docs/CI.md). The repository itself is imported.
#
# NOT here: secret values (`gh secret set NAME --env production`: in Terraform they would be in
# the state; scripts/check-gh-secrets.ts checks the names), installing the Claude GitHub app (the
# provider cannot, on a personal account), and the approval asked for before a fork's pull request
# runs workflows (no resource for it; it is GitHub's default, "first-time contributors").

terraform {
  required_version = ">= 1.10"
  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
  }
  # State: in R2 (infra/README.md), with AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from an R2 token
  backend "s3" {
    bucket                      = "chordless-tfstate"
    key                         = "github/terraform.tfstate"
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

# Auth: GITHUB_TOKEN in the environment (GITHUB_TOKEN=$(gh auth token) locally)
provider "github" {
  owner = "bloodearnest"
}

variable "repository" {
  type    = string
  default = "chordless"
}

variable "required_approvals" {
  description = <<-EOT
    Approvals a pull request needs. 0 while agents push as the repository's owner, who cannot
    approve their own pull requests; 1 once agents have an identity of their own (docs/CI.md)
  EOT
  type        = number
  default     = 0
}

import {
  to = github_repository.chordless
  id = "chordless"
}

resource "github_repository" "chordless" {
  name        = var.repository
  description = "App for managing and sharing chord charts and setlists"
  visibility  = "public"

  has_issues   = true
  has_projects = true
  has_wiki     = true

  # Linear history with no merge commits: GitHub's "Rebase and merge" only. A branch must be up to
  # date with main to merge (the ruleset), and can be brought up to date from the pull request
  allow_merge_commit = false
  allow_squash_merge = false
  allow_rebase_merge = true
  # "Enable auto-merge" on a pull request: it merges itself once its required checks pass (Dependabot's
  # weekly pull request is set to, .github/workflows/dependabot-auto-merge.yml)
  allow_auto_merge       = true
  allow_update_branch    = true
  delete_branch_on_merge = true

  security_and_analysis {
    secret_scanning {
      status = "enabled"
    }
    secret_scanning_push_protection {
      status = "enabled"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Dependabot's alerts, which its security updates need
resource "github_repository_vulnerability_alerts" "chordless" {
  repository = github_repository.chordless.name
  enabled    = true
}

resource "github_repository_dependabot_security_updates" "chordless" {
  depends_on = [github_repository_vulnerability_alerts.chordless]

  repository = github_repository.chordless.name
  enabled    = true
}

# main: changed only by a pull request whose `ci-ok` passed on a branch up to date with it, and whose
# CodeQL findings are below the thresholds, merged by rebase; never force-pushed or deleted. No one
# bypasses it, the owner included.
resource "github_repository_ruleset" "main" {
  name        = "main"
  repository  = github_repository.chordless.name
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    deletion                = true
    non_fast_forward        = true
    required_linear_history = true

    pull_request {
      allowed_merge_methods             = ["rebase"]
      required_approving_review_count   = var.required_approvals
      dismiss_stale_reviews_on_push     = true
      require_last_push_approval        = var.required_approvals > 0
      required_review_thread_resolution = false
      require_code_owner_review         = false
    }

    required_status_checks {
      strict_required_status_checks_policy = true
      required_check {
        context = "ci-ok"
        # GitHub Actions: a status of that name from anywhere else does not count
        integration_id = 15368
      }
    }

    # CodeQL's findings block a merge (.github/workflows/codeql.yml; what it checks is
    # .github/codeql/codeql-config.yml): a security finding of high severity or more, or any other
    # finding at error level. Below those they are shown, not blocking. A false positive is dismissed
    # in the Security tab, with the reason, and then no longer blocks.
    required_code_scanning {
      required_code_scanning_tool {
        tool                      = "CodeQL"
        security_alerts_threshold = "high_or_higher"
        alerts_threshold          = "errors"
      }
    }
  }
}

# What workflows may use: GitHub's own actions and those listed here (none yet: ask first,
# docs/CI.md), each pinned to a full commit SHA
resource "github_actions_repository_permissions" "chordless" {
  repository           = github_repository.chordless.name
  enabled              = true
  allowed_actions      = "selected"
  sha_pinning_required = true

  allowed_actions_config {
    github_owned_allowed = true
    verified_allowed     = false
    patterns_allowed     = []
  }
}

# A workflow's token reads by default, and cannot approve pull requests
resource "github_workflow_repository_permissions" "chordless" {
  repository                       = github_repository.chordless.name
  default_workflow_permissions     = "read"
  can_approve_pull_request_reviews = false
}

# Who reviews: an infra-apply job waits for their approval (the repository's owner)
variable "reviewer_id" {
  description = "GitHub user id of the one who approves applies (gh api user -q .id)"
  type        = number
  default     = 1042
}

# Each given only to workflows running on main (docs/CI.md):
# - production: the deploy's secrets
# - infra: read-only credentials, for Terraform plans and the drift check
# - infra-apply: the credentials that can change things, only after the reviewer approves the plan
resource "github_repository_environment" "env" {
  for_each    = toset(["production", "infra", "infra-apply"])
  repository  = github_repository.chordless.name
  environment = each.key

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }

  dynamic "reviewers" {
    for_each = each.key == "infra-apply" ? [var.reviewer_id] : []
    content {
      users = [reviewers.value]
    }
  }
}

resource "github_repository_environment_deployment_policy" "main" {
  for_each       = github_repository_environment.env
  repository     = github_repository.chordless.name
  environment    = each.value.environment
  branch_pattern = "main"
}
