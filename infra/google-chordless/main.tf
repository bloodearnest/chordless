# Google Cloud config for the `chordless-app` project, the app project (docs/CLOUD_MIGRATION.md).
# Created by Terraform, not imported.
#
# NOT here: the OAuth consent screen and the web OAuth client (the provider cannot manage them),
# the service account's key (it would land in the state file: made by hand, kept in a Worker
# secret), and the API key *values* (read them in the console). Adding the service account to a
# team's shared drive is a Drive admin action.
terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

# Auth: `gcloud auth application-default login`, or GOOGLE_OAUTH_ACCESS_TOKEN.
provider "google" {
  project = "chordless-app"
}

resource "google_project" "app" {
  project_id = "chordless-app"
  name       = "chordless"
}

resource "google_project_service" "drive" {
  project            = google_project.app.project_id
  service            = "drive.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "picker" {
  project            = google_project.app.project_id
  service            = "picker.googleapis.com"
  disable_on_destroy = false
}

# Needed to create the API keys below, and by IAM for the service account.
resource "google_project_service" "apikeys" {
  project            = google_project.app.project_id
  service            = "apikeys.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "iam" {
  project            = google_project.app.project_id
  service            = "iam.googleapis.com"
  disable_on_destroy = false
}

# Browser key for the Google Picker (team-space folder picker): Picker only, from our origins.
resource "google_apikeys_key" "team" {
  name         = "team-key"
  display_name = "Team Key"
  project      = google_project.app.project_id

  restrictions {
    api_targets {
      service = "picker.googleapis.com"
    }
    browser_key_restrictions {
      allowed_referrers = [
        "https://chordless.app/*",
        "http://localhost:8787/*",
      ]
    }
  }

  depends_on = [google_project_service.apikeys, google_project_service.picker]
}

# Server key (Worker secret GOOGLE_API_KEY) for share link downloads: no referrer restriction,
# since the Worker sends none. Drive only.
resource "google_apikeys_key" "sharing" {
  name         = "sharing-key"
  display_name = "Sharing Key"
  project      = google_project.app.project_id

  restrictions {
    api_targets {
      service = "drive.googleapis.com"
    }
  }

  depends_on = [google_project_service.apikeys, google_project_service.drive]
}

# Service account for team-managed storage (docs/SPACES.md). No project roles: it works through
# the shared drive it is added to. (It moves to its own project later: CLOUD_MIGRATION.md, step 6.)
resource "google_service_account" "team_storage" {
  account_id  = "team-storage"
  description = "Chordless account to maintain shared Teams files"
  project     = google_project.app.project_id

  depends_on = [google_project_service.iam]
}

output "project_number" {
  description = "The Picker app id (src/dev/*.js, docs/SPACES.md)."
  value       = google_project.app.number
}
