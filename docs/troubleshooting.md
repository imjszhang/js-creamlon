---
title: Troubleshooting
audience: all users
status: current
verified: 0.4.1
---

# Troubleshooting

Start by checking the installed version:

```bash
creamlon help
```

Use documentation from the matching Git tag when the installed version differs
from this page's `verified` value.

## Authentication fails

Set `GITHUB_TOKEN` or `GH_TOKEN`, or pass `--token`. Confirm that the token can
access the repository and perform the requested read, Issue, or content
operation. Do not print the token while diagnosing the problem.

## Discovery returns no nodes

Check that the node repository is public, non-forked, non-archived, has Issues
enabled, uses the `creamlon-node` Topic, and publishes a valid root-level
`creamlon.yaml`. Confirm capability ID, status, and media-type filters. Use
`--refresh` to bypass the local discovery cache.

## Submission is rejected

Inspect the current manifest. Confirm the capability ID and media type, use
exactly one input location, and provide expiry or access options required by
the node. A credential must match the node, capability, task intent, and expiry.

## A credential cannot be reused

This is expected after successful redemption. Credentials authorize one task
intent and are consumed when delivery is accepted, even if later publication
must be resumed.

## Delivery stopped partway through

Run the same `deliver` command with `--resume`. Do not create a second proof or
manually edit redemption state. After recovery, run `audit` and refresh
`status`.

## Proof verification fails

Treat the result as unverified. Check the Issue number, repository, comment
author, current or historical node identity, task input digest, output digest,
credential binding, and key-rotation history.

## Private delivery fails

Confirm both peers use the advertised delivery scheme and transport. Keep
outbox state and private URLs local. Nodes must advertise
`hpke-x25519-hkdf-sha256-aes256gcm-v2` (RFC 9180).

For `github-private-repo`, a `403` or `404` during `fetch-input` or
`send-output` usually means the node token cannot access the caller-owned
private inbox. Grant that token repository contents read/write access, or use
`presigned-object-storage` to avoid standing cross-repository permissions.

For command-specific options, run `creamlon help <command>`. Report suspected
security failures through the [security policy](../SECURITY.md).
