---
title: CLI reference
audience: all users
status: current
verified: 0.8.1
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
| Find and inspect service stores | `discover`, `inspect` |
| Manage your service catalog | `capability add`, `capability update`, `capability remove`, `capability list`, `payment set-provider`, `payment remove-provider`, `payment list`, `delivery set-config`, `delivery show-config`, `node set-status`, `node set-name`, `node set-description`, `validate` |
| Place and verify orders | `submit`, `tasks`, `cancel`, `fetch-proof` |
| Process order Issues | `watch`, `deliver`, `reject` |
| Manage store identity | `keygen`, `key-rotate` |
| Manage access passes | `credential create`, `credential list`, `credential show`, `credential revoke`, `credential gc`, `hmac-key-new`, `hmac-key-list`, `hmac-key-revoke`, `hmac-key-rotate` |
| Manage caller inboxes | `caller inbox init`, `caller inbox grant`, `caller inbox protect`, `caller inbox check`, `caller inbox revoke`, `caller inbox list`, `caller inbox remove` |
| Work with signed receipts | `hash`, `sign`, `verify`, `proofs list`, `proofs show`, `audit`, `status` |
| Create a store | `init` |
| Use private delivery | `extension delivery keygen`, `extension delivery prepare`, `extension delivery draft`, `extension delivery send-input`, `extension delivery fetch-input`, `extension delivery send-output`, `extension delivery fetch-output`, `extension delivery status`, `extension delivery cleanup` |

## Common Options

Most commands that print structured data support `--pretty`. GitHub-backed
commands accept `--token <pat>` or read `GITHUB_TOKEN` / `GH_TOKEN`.

Use `--version`, `-V`, or `version` to print the installed package version.
Use `--json-errors` when invoking the binary from scripts that need structured
error output.

## Init Command

`init <dir> [--name <name>] [--layout root|bundled]` scaffolds a node. The
default `root` layout writes `creamlon.yaml` and `trust/`; `bundled` writes
`.creamlon/manifest.yaml` and `.creamlon/trust/`. Root layout requires an
empty directory. Bundled layout can be added to an existing repository when
Creamlon template target files do not already exist; it keeps an existing
`README.md` and merges missing Creamlon private-state patterns into
`.gitignore`.

## Local Manifest Commands

`validate [--repo-path <dir>]` checks only the local node manifest. The CLI
prefers `.creamlon/manifest.yaml` and falls back to `creamlon.yaml`.

`capability add` requires `--id`, `--description`, `--input-type`, and
`--output-type`. `capability update` accepts the same fields but updates only
the options supplied. `--access free|credential` records capability access
policy. `--units 1` can record the credential unit count for access-controlled
capabilities.

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
and closes a task Issue only when the task body requester matches. Use
`--reason <text>` to publish a caller-readable cancellation reason.

`watch`, `deliver`, and `reject` are node-operator commands. `watch --once`
performs a single poll. `deliver` requires `--output-file`; use `--dry-run` to
prepare without publishing and `--resume` after interruption. Extension
delivery tasks must upload output first with `extension delivery send-output`.

## Access Commands

`credential create --capability-id <id>` prints the full credential once.
`credential list` omits secrets. `credential show <id>` prints the full local
credential again. `credential gc` removes redeemed or expired local records.

`hmac-key-new --key-id <id>` creates a private authorization key map.
`hmac-key-list`, `hmac-key-revoke --key-id <id>`, and
`hmac-key-rotate --key-id <id>` manage the private key ids without printing
secrets.

## Proof And Trust Commands

`proofs list [--limit <n>]` summarizes the local public proof log, preferring
`.creamlon/trust/proofs.log` and falling back to `trust/proofs.log`.
`proofs show --request-id <id>` prints one proof.

`audit` verifies local manifest, proof log, redemptions, and key continuity.
`status` writes the matching public `status.json` with audit health and
delivery summary fields. Use `--status-out <path>` to write somewhere other
than the default trust file.

`inspect <owner/repo> --trust` also reads public trust status and key
continuity files.

## Delivery Commands

`extension delivery status` summarizes local outbox and delivery state files.
`extension delivery cleanup <owner/repo>` removes local state only for delivery
records that reached local `closed` status with a stored proof and whose remote
Issue is already closed.

`extension delivery fetch-output` verifies the proof and output digest by
default; `--no-verify` skips that verification only when you have another trust
path.

## Authentication

`submit`, `deliver`, `reject`, `cancel`, and `caller inbox` management require
`GITHUB_TOKEN`, `GH_TOKEN`, or `--token`. Public reads can run anonymously with
lower rate limits.

## Stable sources

- [Caller guide](../guides/caller.md)
- [Node operator guide](../guides/node-operator.md)
- [Protocol specification](../../references/protocol.md)
- [Extension specifications](../../extensions/README.md)

Avoid duplicating the complete option list in guides. It changes faster than
task workflows and belongs in `creamlon help <command>`.
