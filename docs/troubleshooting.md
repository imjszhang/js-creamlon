---
title: Troubleshooting
audience: all users
status: current
verified: 0.8.2
---

# Troubleshooting

Start by checking the installed version:

```bash
creamlon help
```

Use documentation from the matching Git tag when the installed version differs
from this page's `verified` value.

## Authentication fails

Most write operations act on a melon repository or an order Issue.
Set `GITHUB_TOKEN` or `GH_TOKEN`, or pass `--token`. Confirm that the token can
access the repository and perform the requested read, Issue, or content
operation. Do not print the token while diagnosing the problem.

## Discovery returns no melons

Discovery only lists repositories that are valid public melons.
Check that the melon repository is public, non-forked, non-archived, has Issues
enabled, uses the `creamlon-node` Topic, and publishes a valid manifest at
`creamlon.yaml` or `.creamlon/manifest.yaml`. Confirm capability ID, status,
and media-type filters. Use `--refresh` to bypass the local discovery cache.

## Submission is rejected

An order is rejected when it does not match the melon's current service catalog.
Inspect the current manifest. Confirm the capability ID and media type, use
exactly one input location, and provide expiry or access options required by
the melon. A credential must match the melon, capability, task intent, and
expiry.

## A credential cannot be reused

This is expected after successful redemption. A credential is a one-time access
pass for one order intent and is consumed when delivery is accepted, even if
later publication must be resumed.

## Delivery stopped partway through

Delivery is designed to resume without minting a second receipt.
Run the same `deliver` command with `--resume`. Do not create a second proof or
manually edit redemption state. After recovery, run `audit` and refresh
`status`.

## Proof verification fails

Treat the delivery receipt as untrusted until verification succeeds.
Treat the result as unverified. Check the Issue number, repository, comment
author, current or historical melon identity, task input digest, output digest,
credential binding, and key-rotation history.

## Private delivery fails

Confirm both peers use the advertised delivery scheme and transport. Keep
outbox state and private URLs local. Melons must advertise
`hpke-x25519-hkdf-sha256-aes256gcm-v2` (RFC 9180).

For `github-private-repo`, a `403` or `404` during `fetch-input` or
`send-output` usually means the melon's token cannot access the caller-owned
private inbox. Grant that token repository contents read/write access, or use
`presigned-object-storage` to avoid standing cross-repository permissions.

Run `creamlon caller inbox check --node owner/repo` with the caller token. If
the operator permission is missing, confirm the invitation was accepted and
that `profiles.github.operator` names a user rather than an organization. Use
one inbox repository per melon; path prefixes in a shared repository do not
limit collaborator write access.

If setup reports that the inbox points at the node repository, create or select
a separate caller-owned private inbox and run `caller inbox init` again. The
delivery setup expects public Issues and trust records to stay on the melon
repository while private artifacts move through the inbox repository.

Run `creamlon caller inbox protect --node owner/repo` to block force-push and
branch deletion where supported. A valid GitHub task must contain
`delivery.github.input_commit`; missing revisions indicate that `send-input`
did not finish writing the task, extensions file, and outbox before submission.

For fine-grained caller tokens, `caller inbox grant` and `revoke` require
repository Administration write permission. Personal inbox repositories use
the default `push` collaborator role; custom `maintain` or `admin` grants
require an organization-owned inbox.

For command-specific options, run `creamlon help <command>`. Report suspected
security failures through the [security policy](../SECURITY.md).
