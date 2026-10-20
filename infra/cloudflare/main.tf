# Cloudflare config for chordless.app that wrangler does not own.
#
# NOT here, on purpose: the Worker, its assets and the rate limiters. `wrangler deploy` owns those (wrangler.toml); managing them here too would make
# two tools fight over the same objects. Secrets are `wrangler secret put` (push-secrets.sh).
#
# Here: the Worker's custom domain (the one thing about the Worker that is zone infrastructure, not
# code: wrangler.toml has no `routes` for it, so a deploy never touches it), and Email Routing, which sends import@chordless.app to the Worker's email() handler
# (docs/EMAIL_IMPORT.md), and the zone's own DNS records and TLS settings. The records Cloudflare
# owns are not managed: the custom domain's AAAA, and Email Routing's MX and DKIM.

terraform {
  required_version = ">= 1.5"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

# Auth: CLOUDFLARE_API_TOKEN in the environment (Email Routing: Edit, Zone: Read).
provider "cloudflare" {}

variable "account_id" {
  type    = string
  default = "589e207ea16d7e9db96c2b3d2ae87833"
}

variable "zone_id" {
  description = "Zone id of chordless.app"
  type        = string
  default     = "03ecba88194d19b6e9998db7e04bd95d"
}

variable "worker_name" {
  type    = string
  default = "chordless"
}

# chordless.app -> the Worker. Cloudflare creates and owns the DNS record and certificate for it.
# The Worker must exist first (`wrangler deploy`), or a fresh account fails to attach it.
resource "cloudflare_workers_custom_domain" "app" {
  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = "chordless.app"
  service    = var.worker_name
}

resource "cloudflare_email_routing_settings" "chordless" {
  zone_id            = var.zone_id
  support_subaddress = false
}

# import@chordless.app -> the Worker
resource "cloudflare_email_routing_rule" "import" {
  zone_id  = var.zone_id
  name     = ""
  enabled  = true
  priority = 0

  matchers = [{
    type  = "literal"
    field = "to"
    value = "import@chordless.app"
  }]

  actions = [{
    type  = "worker"
    value = [var.worker_name]
  }]
}

# Everything else: the catch-all rule exists but is switched off, so other addresses bounce.
resource "cloudflare_email_routing_catch_all" "chordless" {
  zone_id = var.zone_id
  name    = ""
  enabled = false

  matchers = [{
    type = "all"
  }]

  actions = [{
    type = "drop"
  }]
}

# Adopt what already exists (terraform plan should then show no changes).
import {
  to = cloudflare_email_routing_settings.chordless
  id = var.zone_id
}

import {
  to = cloudflare_email_routing_rule.import
  id = "${var.zone_id}/e0679651bb844657a1ddbf9652836cfe"
}

import {
  to = cloudflare_email_routing_catch_all.chordless
  id = var.zone_id
}

import {
  to = cloudflare_workers_custom_domain.app
  id = "${var.account_id}/8680dc8d6ee663ffe546da4f1bc6583729a8530e"
}

# DNS: only the records that are ours to edit.
resource "cloudflare_dns_record" "spf" {
  zone_id = var.zone_id
  name    = "chordless.app"
  type    = "TXT"
  content = "\"v=spf1 include:_spf.mx.cloudflare.net ~all\""
  ttl     = 1
}

# Proves to Google that we own the domain (the OAuth consent screen's authorised domain).
resource "cloudflare_dns_record" "google_site_verification" {
  zone_id = var.zone_id
  name    = "chordless.app"
  type    = "TXT"
  content = "\"google-site-verification=_ad0WgflNxkg0d3FXGU9WF4MG8jKIyBO68pMtzCli3g\""
  ttl     = 3600
}

# Zone settings: only the ones about TLS and HTTPS, the rest are Cloudflare's defaults. Tightened
# 2026-10-20 from full / off / 1.0: plain http is redirected, and TLS 1.2 is the floor (the app's
# browser floor, iOS/Safari 17 and Chrome 120, speaks it).
locals {
  zone_settings = {
    ssl                      = "strict"
    always_use_https         = "on"
    min_tls_version          = "1.2"
    tls_1_3                  = "on"
    automatic_https_rewrites = "on"
  }
}

resource "cloudflare_zone_setting" "this" {
  for_each   = local.zone_settings
  zone_id    = var.zone_id
  setting_id = each.key
  value      = each.value
}

import {
  to = cloudflare_dns_record.spf
  id = "${var.zone_id}/230253abee488bfcb6c7adab3ac2f00b"
}

import {
  to = cloudflare_dns_record.google_site_verification
  id = "${var.zone_id}/b52573488a6c939a55c4ec30bf9f8bfa"
}

import {
  for_each = local.zone_settings
  to       = cloudflare_zone_setting.this[each.key]
  id       = "${var.zone_id}/${each.key}"
}
