# Honeycomb (docs/OBSERVABILITY.md): where the page's and the Worker's traces go. An environment for
# production and one for dev (so local work cannot fill the real dataset), and an ingest key for each.
# That is all for now. NOT here:
# - Datasets: the first span makes one (the key may create datasets).
# - SLOs and triggers: they need a configuration key for the environment, which is not the
#   management key this stack uses, and a dataset to exist first.
# - The key's value on the Worker: by hand, `wrangler secret put OTLP_HEADERS` (infra/README.md), as
#   with every Worker secret. The value is in this stack's state (an ingest key can only send
#   events, which is why that is accepted), and is shown by `terraform output -raw`.
# - Cloudflare's side of the Worker's own traces: the destination is made in the dashboard.
terraform {
  required_version = ">= 1.10"
  required_providers {
    honeycombio = {
      source  = "honeycombio/honeycombio"
      version = "~> 0.55"
    }
  }
  # State: in R2 (infra/README.md), with AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from an R2 token
  backend "s3" {
    bucket                      = "chordless-tfstate"
    key                         = "honeycomb/terraform.tfstate"
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

# Auth: a Honeycomb management key (Team settings > API keys), as HONEYCOMB_KEY_ID and
# HONEYCOMB_KEY_SECRET, with the scopes environments:write and api-keys:write.
# Our team is on the EU instance: a different host, and the US one answers "invalid API key".
provider "honeycombio" {
  api_url = "https://api.eu1.honeycomb.io"
}

resource "honeycombio_environment" "prod" {
  name             = "chordless-prod"
  description      = "chordless.app"
  color            = "blue"
  delete_protected = true
}

resource "honeycombio_environment" "dev" {
  name        = "chordless-dev"
  description = "npm run dev, and the tests that send telemetry"
  color       = "green"
}

# The Worker's OTLP_HEADERS is `x-honeycomb-team=<this key>`. It can send events and make the
# datasets they go to, and do nothing else.
resource "honeycombio_api_key" "prod_ingest" {
  name           = "chordless-prod ingest"
  type           = "ingest"
  environment_id = honeycombio_environment.prod.id

  permissions {
    create_datasets = true
  }
}

resource "honeycombio_api_key" "dev_ingest" {
  name           = "chordless-dev ingest"
  type           = "ingest"
  environment_id = honeycombio_environment.dev.id

  permissions {
    create_datasets = true
  }
}

output "prod_ingest_key" {
  description = "For `wrangler secret put OTLP_HEADERS`, as x-honeycomb-team=<this>"
  value       = honeycombio_api_key.prod_ingest.key
  sensitive   = true
}

output "dev_ingest_key" {
  description = "For .dev.vars, as OTLP_HEADERS=x-honeycomb-team=<this>"
  value       = honeycombio_api_key.dev_ingest.key
  sensitive   = true
}
