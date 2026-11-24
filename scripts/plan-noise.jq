# `terraform show -json <plan>` | jq -e -f scripts/plan-noise.jq
#
# True when the plan changes nothing that is ours: every change is an update in place that only
# touches values the provider reports about the object ("known after apply": the D1 database's size and
# tables, with provider 5.29), the rest of it being what is already recorded. Such a plan would ask for an
# approval to change nothing, on every deploy, and fail the nightly drift check on every night.
#
# A workaround, not a fix: provider 5.29.0 (the latest when this was written) has no plan modifier to
# keep those values from state, so cloudflare_d1_database plans them unknown on every update. Remove this
# (and its use in scripts/terraform-ci.sh, its test and tests/fixtures/terraform-plan-d1.json) once a
# release no longer plans a change for the D1 database in a plan with nothing else in it.
#
# Careful on purpose, so that a real change is never taken for one: a create, a delete, a replace, an
# import, a move, a forgotten resource, a changed output, and an update that changes any value Terraform
# knows are all changes. Anything it cannot read is a change too (jq -e fails on no input).
(.output_changes // {} | all(.[]; .actions == ["no-op"]))
and
([ .resource_changes[]?
   | select((.change.actions != ["no-op"] and .change.actions != ["read"])
           or .change.importing != null
           or .previous_address != null)
   | select(
       (.change.actions == ["update"]
        and .change.importing == null
        and .previous_address == null
        and (.change.after_unknown as $unknown
             | .change.before as $before
             | .change.after
             | to_entries
             | all(.[]; $unknown[.key] == true or $before[.key] == .value)))
       | not)
 ] | length == 0)
