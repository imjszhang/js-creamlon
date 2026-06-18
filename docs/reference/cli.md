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
| Manage local node manifest | `capability add`, `capability remove`, `capability list`, `payment set-provider`, `payment remove-provider`, `payment list`, `node set-status` |
| Submit and verify tasks | `submit`, `fetch-proof` |
| Operate task Issues | `watch`, `deliver`, `reject` |
| Manage node identity | `keygen`, `key-rotate` |
| Manage access | `credential create`, `credential list`, `credential revoke`, `hmac-key-new` |
| Manage caller inboxes | `caller inbox init`, `grant`, `protect`, `check`, `revoke` |
| Work with proofs | `hash`, `sign`, `verify`, `audit`, `status` |
| Create a node | `init` |
| Use private delivery | `extension delivery ...` |

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
