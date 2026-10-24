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
