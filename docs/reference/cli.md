---
title: CLI reference
audience: all users
status: current
verified: 0.7.0
---

# CLI reference

The installed CLI is the authoritative source for command options:

```bash
creamlon help
creamlon help <command>
```

The command reports its package version in the main help output. Make sure it
matches the documentation version you are reading.

## Command groups

| Goal | Commands |
| --- | --- |
| Discover and inspect nodes | `discover`, `inspect` |
| Manage local node manifest | `capability add`, `capability update`, `capability remove`, `capability list`, `payment set-provider`, `payment remove-provider`, `payment list`, `delivery set-config`, `delivery show-config`, `node set-status`, `node set-name`, `node set-description`, `validate` |
| Submit and verify tasks | `submit`, `tasks`, `cancel`, `fetch-proof` |
| Operate task Issues | `watch`, `deliver`, `reject` |
| Manage node identity | `keygen`, `key-rotate` |
| Manage access | `credential create`, `credential list`, `credential show`, `credential revoke`, `credential gc`, `hmac-key-new`, `hmac-key-list`, `hmac-key-revoke`, `hmac-key-rotate` |
| Manage caller inboxes | `caller inbox init`, `caller inbox grant`, `caller inbox protect`, `caller inbox check`, `caller inbox revoke`, `caller inbox list`, `caller inbox remove` |
| Work with proofs | `hash`, `sign`, `verify`, `proofs list`, `proofs show`, `audit`, `status` |
| Create a node | `init` |
| Use private delivery | `extension delivery keygen`, `extension delivery prepare`, `extension delivery draft`, `extension delivery send-input`, `extension delivery fetch-input`, `extension delivery send-output`, `extension delivery fetch-output`, `extension delivery status`, `extension delivery cleanup` |

## Common Options

Most commands that print structured data support `--pretty`. GitHub-backed
commands accept `--token <pat>` or read `GITHUB_TOKEN` / `GH_TOKEN`.

Use `--version`, `-V`, or `version` to print the installed package version.
Use `--json-errors` when invoking the binary from scripts that need structured
error output.

## Local Manifest Commands

`validate [--repo-path <dir>]` checks only local `creamlon.yaml`.

`capability add` requires `--id`, `--description`, `--input-type`, and
`--output-type`. `capability update` accepts the same fields but updates only
the options supplied. `--access free|credential` records capability access
policy.

`payment set-provider` requires `--capability-id` and `--provider-id`, and can
record `--resource-url`, `--price`, `--network`, `--asset`, `--pay-to`,
`--facilitator`, `--checkout-url`, and `--instructions`.

`delivery set-config` manages `extensions.delivery` with `--scheme`,
`--receive-public-key`, `--transports`, `--presigned-hosts`,
`--github-input-path`, and `--github-output-path`.

`node set-status <available|busy|offline>`, `node set-name <name>`, and
`node set-description <text>` update node-level metadata.

## Task Commands

`submit <owner/repo>` creates a task Issue. It requires `--capability-id`,
`--requester`, `--media-type`, and exactly one input mode:
`--input`, `--input-digest`, or `--input-url`. Use `--task-file` for prepared
delivery tasks.

`tasks <owner/repo>` lists task Issues and can filter by
`--requester <github:user/repo>`.

`cancel <owner/repo> <issue-number> --requester <github:user/repo>` comments on
and closes a task Issue only when the task body requester matches.

`watch`, `deliver`, and `reject` are node-operator commands. `deliver` requires
`--output-file`; extension delivery tasks must upload output first with
`extension delivery send-output`.

## Access Commands

`credential create --capability-id <id>` prints the full credential once.
`credential list` omits secrets. `credential show <id>` prints the full local
credential again. `credential gc` removes redeemed or expired local records.

`hmac-key-new --key-id <id>` creates a private authorization key map.
`hmac-key-list`, `hmac-key-revoke --key-id <id>`, and
`hmac-key-rotate --key-id <id>` manage the private key ids without printing
secrets.

## Proof And Trust Commands

`proofs list [--limit <n>]` summarizes local `trust/proofs.log`.
`proofs show --request-id <id>` prints one proof.

`audit` verifies local manifest, proof log, redemptions, and key continuity.
`status` writes `trust/status.json` with audit health and delivery summary
fields.

`inspect <owner/repo> --trust` also reads public trust status and key
continuity files.

## Delivery Commands

`extension delivery status` summarizes local outbox and delivery state files.
`extension delivery cleanup <owner/repo>` removes local state only for delivery
records that reached local `closed` status with a stored proof and whose remote
Issue is already closed.

## Authentication

`submit`, `deliver`, `reject`, and `caller inbox` management require
`GITHUB_TOKEN`, `GH_TOKEN`, or `--token`. Public reads can run anonymously with
lower rate limits.

## Stable sources

- [Caller guide](../guides/caller.md)
- [Node operator guide](../guides/node-operator.md)
- [Protocol specification](../../references/protocol.md)
- [Extension specifications](../../extensions/README.md)

Avoid duplicating the complete option list in guides. It changes faster than
task workflows and belongs in `creamlon help <command>`.
