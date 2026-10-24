# Google Cloud config for the DEV project: the OAuth client the local app and the real-Drive suite
# (docs/DRIVE_TESTS.md) use, apart from the app's own project (`../google-chordless/`). It is the
# project the app started in (project id `setalight`; the id cannot change), restored from deletion
# on 2026-10-24 and renamed `chordless-dev`. Imported, not created.
#
# Why a second project: Drive API quota and the consent screen belong to a project, and under
# `drive.file` a client sees only the files it made. So tests and local work here cannot use up
# the real app's quota, break its sign-in, or touch its users' files.
#
# NOT here (the provider cannot manage them): the OAuth consent screen (keep it in Testing, with the
# test account as a test user) and the Web/Desktop OAuth client. By hand, in the console.
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

import {
  to = google_project.dev
  id = "projects/setalight"
}

resource "google_project" "dev" {
  project_id = "setalight"
  name       = "chordless-dev"
  # (no billing: the Drive API is free, and nothing here needs it)
  deletion_policy = "PREVENT"
}

resource "google_project_service" "drive" {
  project            = google_project.dev.project_id
  service            = "drive.googleapis.com"
  disable_on_destroy = false
}

# Needed to manage the API keys below, and the service account.
resource "google_project_service" "apikeys" {
  project            = google_project.dev.project_id
  service            = "apikeys.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "iam" {
  project            = google_project.dev.project_id
  service            = "iam.googleapis.com"
  disable_on_destroy = false
}

# The Google Picker (team-space folder picker) in dev: Picker only, from the local addresses only
# (not chordless.app: the production page uses the app project's key). Its value is PICKER_API_KEY
# in .dev.vars. Imported: it came back with the project.
import {
  to = google_apikeys_key.team
  id = "projects/setalight/locations/global/keys/97aa76c6-71d6-4a27-b74c-a373c345e1c6"
}

resource "google_apikeys_key" "team" {
  name         = "97aa76c6-71d6-4a27-b74c-a373c345e1c6"
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
import {
  to = google_apikeys_key.sharing
  id = "projects/setalight/locations/global/keys/4bc5b8b1-c544-4255-a08f-bf52b7804486"
}

resource "google_apikeys_key" "sharing" {
  name         = "4bc5b8b1-c544-4255-a08f-bf52b7804486"
  display_name = "Sharing Key"
  project      = google_project.dev.project_id

  restrictions {
    api_targets {
      service = "drive.googleapis.com"
    }
  }

  depends_on = [google_project_service.apikeys]
}

# The first app's service account came back with the project, and its key (made 2026-10-20) with
# it. Nothing uses it: disabled, so neither it nor its key works.
import {
  to = google_service_account.broker
  id = "projects/setalight/serviceAccounts/broker@setalight.iam.gserviceaccount.com"
}

resource "google_service_account" "broker" {
  account_id  = "broker"
  description = "Chordless account to maintain shared Teams files"
  project     = google_project.dev.project_id
  disabled    = true

  depends_on = [google_project_service.iam]
}

output "project_number" {
  description = "The Picker app id in .env.development."
  value       = google_project.dev.number
}
