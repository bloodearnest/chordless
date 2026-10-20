# Google Cloud config for the `setalight` project, as it stands (captured 2026-10-20).
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
  project = "setalight"
}

resource "google_project" "app" {
  project_id = "setalight"
  name       = "chordless-old"
}

resource "google_project_service" "drive" {
  service            = "drive.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "picker" {
  service            = "picker.googleapis.com"
  disable_on_destroy = false
}

# Browser key for the Google Picker (team-space folder picker): Picker only, from our origins.
resource "google_apikeys_key" "team" {
  name         = "97aa76c6-71d6-4a27-b74c-a373c345e1c6"
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
}

# Server key (Worker secret GOOGLE_API_KEY) for share link downloads: no referrer restriction,
# since the Worker sends none. Drive only (Picker was dropped 2026-10-20: nothing used it).
resource "google_apikeys_key" "sharing" {
  name         = "4bc5b8b1-c544-4255-a08f-bf52b7804486"
  display_name = "Sharing Key"
  project      = google_project.app.project_id

  restrictions {
    api_targets {
      service = "drive.googleapis.com"
    }
  }
}

# Service account for team-managed storage (docs/SPACES.md). No project roles: it works through
# the shared drive it is added to.
resource "google_service_account" "broker" {
  account_id  = "broker"
  description = "Chordless account to maintain shared Teams files"
  project     = google_project.app.project_id
}

# Adopt what already exists (terraform plan should then show no changes).
import {
  to = google_project.app
  id = "projects/setalight"
}

import {
  to = google_project_service.drive
  id = "setalight/drive.googleapis.com"
}

import {
  to = google_project_service.picker
  id = "setalight/picker.googleapis.com"
}

import {
  to = google_apikeys_key.team
  id = "projects/setalight/locations/global/keys/97aa76c6-71d6-4a27-b74c-a373c345e1c6"
}

import {
  to = google_apikeys_key.sharing
  id = "projects/setalight/locations/global/keys/4bc5b8b1-c544-4255-a08f-bf52b7804486"
}

import {
  to = google_service_account.broker
  id = "projects/setalight/serviceAccounts/broker@setalight.iam.gserviceaccount.com"
}

# The APIs a new project enables by default (BigQuery, Cloud Storage, Datastore, Dataform, Dataplex,
# Cloud Trace, ... 17 in all) are switched off: nothing in chordless uses them, and the project has no
# billing, so there is nothing behind them. They were declared, then removed with this block, which
# makes Terraform disable them (2026-10-20). It stays as the record. Still on besides the two above:
# Logging, Monitoring, Service Usage and Service Management, which `gcloud` and Terraform need.
# If an API is ever wanted again, declare it as a google_project_service like the two above.
removed {
  from = google_project_service.unused

  lifecycle {
    destroy = true
  }
}
