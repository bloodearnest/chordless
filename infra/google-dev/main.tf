# Google Cloud config for the DEV project: the OAuth client the local app and the real-Drive suite
# (docs/DRIVE_TESTS.md) use, apart from the app's own project (`../google-chordless/`). Project id
# `chordless-dev`, created here. (The app's first project, `setalight`, was restored for this on
# 2026-10-24 but its consent screen would not accept an OAuth client, so it was left behind.)
#
# Why a second project: Drive API quota and the consent screen belong to a project, and under
# `drive.file` a client sees only the files it made. So tests and local work here cannot use up
# the real app's quota, break its sign-in, or touch its users' files.
#
# NOT here (the provider cannot manage them): the OAuth consent screen (keep it in Testing, with the
# test account as a test user) and the Web/Desktop OAuth client. By hand, in the console.
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
    key                         = "google-dev/terraform.tfstate"
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
  project = "chordless-dev"
}

resource "google_project" "dev" {
  project_id = "chordless-dev"
  name       = "chordless-dev"
  # (no billing: the Drive API is free, and nothing here needs it)
  deletion_policy = "PREVENT"
}

resource "google_project_service" "drive" {
  project            = google_project.dev.project_id
  service            = "drive.googleapis.com"
  disable_on_destroy = false
}

# Needed to manage the API keys below.
resource "google_project_service" "apikeys" {
  project            = google_project.dev.project_id
  service            = "apikeys.googleapis.com"
  disable_on_destroy = false
}

# The Google Picker (team-space folder picker) in dev: Picker only, from the local addresses only
# (not chordless.app: the production page uses the app project's key). Its value is PICKER_API_KEY
# in .dev.vars.
resource "google_apikeys_key" "team" {
  name         = "chordless-dev-team"
  display_name = "Team Key"
  project      = google_project.dev.project_id

  restrictions {
    api_targets {
      service = "picker.googleapis.com"
    }
    browser_key_restrictions {
      allowed_referrers = [
        "http://localhost:8787/*",
        "http://127.0.0.1:8787/*",
      ]
    }
  }

  depends_on = [google_project_service.apikeys]
}

# Server key (GOOGLE_API_KEY in .dev.vars) for share link downloads in dev: Drive only.
resource "google_apikeys_key" "sharing" {
  name         = "chordless-dev-sharing"
  display_name = "Sharing Key"
  project      = google_project.dev.project_id

  restrictions {
    api_targets {
      service = "drive.googleapis.com"
    }
  }

  depends_on = [google_project_service.apikeys]
}

output "project_number" {
  description = "The Picker app id in .env.development."
  value       = google_project.dev.number
}

# The ids of the two keys, for `just dev-vars` (it reads their values with gcloud; the values are
# not in Terraform's outputs).
output "team_key_uid" {
  value = google_apikeys_key.team.uid
}

output "sharing_key_uid" {
  value = google_apikeys_key.sharing.uid
}
