---
title: Quickstart
audience: new users
status: current
verified: 0.8.0
---

# Quickstart

This guide installs Creamlon, checks the CLI, and shows the shortest public
caller workflow.

## Prerequisites

- Node.js 18 or newer
- A GitHub token for task submission
- A public Creamlon node to call

Public discovery and proof reads can run without a token at lower GitHub rate
limits. Set `GITHUB_TOKEN`, `GH_TOKEN`, or pass `--token` for writes.

## Install and check the CLI

```bash
npm install --global creamlon@0.8.0
creamlon help
```

The first line of the help output should report CLI version `0.8.0`.

## Discover a capability

Replace `echo` and the media types with the capability you need:

```bash
creamlon discover echo \
  --input-type text/plain \
  --output-type text/plain \
  --pretty
```

A usable result identifies a repository, capability, status, accepted media
types, and node identity.

## Inspect before submitting

```bash
creamlon inspect owner/repo --pretty
```

Confirm that the capability is available and accepts the intended input. If it
declares credential access, obtain the complete `crv1_...` credential through
the operator's private channel before continuing.

## Submit a task

```bash
export GITHUB_TOKEN="<github-token>"

creamlon submit owner/repo \
  --capability-id echo \
  --media-type text/plain \
  --input "hello" \
  --requester github:your-user/your-repo \
  --pretty
```

The result contains the created GitHub Issue number. Task input placed in
`--input` or `--input-url` is public. Use a digest and an appropriate delivery
extension when the content must remain private.

## Verify delivery

After the node closes the Issue:

```bash
creamlon fetch-proof owner/repo <issue-number> --verify --pretty
```

Accept the protocol result only when verification succeeds. A valid proof
binds the node identity, task input, and output digest; it does not establish
the usefulness or correctness of the output.

## Next steps

- Follow the complete [caller guide](../guides/caller.md).
- To publish a capability, follow the
  [node operator guide](../guides/node-operator.md).
- Read [security guidance](../operations/security.md) before using credentials
  or private delivery.
