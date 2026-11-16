# Cloudflare config for chordless.app that wrangler does not own.
#
# NOT here, on purpose: the Worker, its assets and the rate limiters. `wrangler deploy` owns those (wrangler.toml); managing them here too would make
# two tools fight over the same objects. Secrets are `wrangler secret put` (docs/ENVIRONMENTS.md).
#
# Here: the Worker's custom domain (the one thing about the Worker that is zone infrastructure, not
# code: wrangler.toml has no `routes` for it, so a deploy never touches it), and Email Routing, which sends import@chordless.app to the Worker's email() handler
# (docs/EMAIL_IMPORT.md), and the zone's own DNS records and TLS settings. The records Cloudflare
# owns are not managed: the custom domain's AAAA, and Email Routing's MX and DKIM.

terraform {
  required_version = ">= 1.10"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
  # State: in R2 (infra/README.md), with AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from an R2 token
  backend "s3" {
    bucket                      = "chordless-tfstate"
    key                         = "cloudflare/terraform.tfstate"
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

# Sending the sign-in code (docs/SPACES.md, "Signing in without Google"): Cloudflare Email Sending, on a
# subdomain of its own so that the sending reputation and the DMARC policy are apart from chordless.app's
# (whose mail is only the import address). Enabled with `wrangler email sending enable mail.chordless.app`,
# which made these records; Terraform owns them from here. If sending is ever disabled and enabled again,
# Cloudflare makes a new DKIM key: copy it into `content` below.
locals {
  mail_bounce_mx = {
    route1 = 19
    route2 = 45
    route3 = 71
  }
}

resource "cloudflare_dns_record" "mail_bounce_mx" {
  for_each = local.mail_bounce_mx
  zone_id  = var.zone_id
  name     = "cf-bounce.mail.chordless.app"
  type     = "MX"
  content  = "${each.key}.mx.cloudflare.net"
  priority = each.value
  ttl      = 1
}

resource "cloudflare_dns_record" "mail_bounce_spf" {
  zone_id = var.zone_id
  name    = "cf-bounce.mail.chordless.app"
  type    = "TXT"
  content = "\"v=spf1 include:_spf.mx.cloudflare.net ~all\""
  ttl     = 1
}

resource "cloudflare_dns_record" "mail_dkim" {
  zone_id = var.zone_id
  name    = "cf-bounce._domainkey.mail.chordless.app"
  type    = "TXT"
  content = "\"v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78k\" \"m4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB\""
  ttl     = 1
}

# Reject what claims to be from mail.chordless.app and fails SPF and DKIM alignment.
resource "cloudflare_dns_record" "mail_dmarc" {
  zone_id = var.zone_id
  name    = "_dmarc.mail.chordless.app"
  type    = "TXT"
  content = "\"v=DMARC1; p=reject;\""
  ttl     = 1
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
  for_each = {
    route1 = "35f1f2803edc1c376cc463f03fc00f69"
    route2 = "500fb44f0f6323e132499f316ba8f700"
    route3 = "c549187657bb4a32883b0bc105e4395d"
  }
  to = cloudflare_dns_record.mail_bounce_mx[each.key]
  id = "${var.zone_id}/${each.value}"
}

import {
  to = cloudflare_dns_record.mail_bounce_spf
  id = "${var.zone_id}/0fc5d6d2003bb02d63dad927499976c1"
}

import {
  to = cloudflare_dns_record.mail_dkim
  id = "${var.zone_id}/3ab99ffe58e148b56834927b1b8a1833"
}

import {
  to = cloudflare_dns_record.mail_dmarc
  id = "${var.zone_id}/4c991779387e7846a3cbcb4d2d8524f8"
}

import {
  for_each = local.zone_settings
  to       = cloudflare_zone_setting.this[each.key]
  id       = "${var.zone_id}/${each.key}"
}

# Where every stack's Terraform state is kept (each stack's `backend "s3"`): R2 speaks S3. This stack
# made it while its own state was still local, then moved its state into it (infra/README.md, "State").
# Never song content (CLAUDE.md): state only.

resource "cloudflare_r2_bucket" "tfstate" {
  account_id = var.account_id
  name       = "chordless-tfstate"
  location   = "WEUR"

  lifecycle {
    prevent_destroy = true
  }
}
