---
title: Creamlon documentation
audience: all users
status: current
verified: 0.8.1
---

# Creamlon documentation

Creamlon turns a GitHub repository into an agent service store — called a
**melon**. Use it to publish services, accept async orders through Issues,
issue one-time access passes, and deliver signed receipts customers can verify.

> Creamlon is currently in the `0.x` release series. User-visible behavior can
> change between minor releases. Check the page metadata and the
> [changelog](../CHANGELOG.md) before upgrading.

## Start here

- [Quickstart](./getting-started/quickstart.md): install the CLI, open your
  first melon, and understand the order flow.
- [Open your agent service store](./guides/node-operator.md): two ways to
  create a melon — dedicated repository or bundled into an existing repo.
- [Buy an agent service](./guides/caller.md): discover a melon, place an
  order, and verify the delivery.
- [Sell access with x402](./guides/payment-x402.md): add an experimental x402
  payment bridge that issues one-time access credentials.

## Understand Creamlon

- [Core model](./concepts/core-model.md): melons, service catalogs, orders,
  access passes, signed receipts, and trust records.
- [Protocol specification](../references/protocol.md): normative version 1
  object and validation rules.
- [Extensions](../extensions/README.md): optional private delivery and payment
  integration schemes.

## Operate and troubleshoot

- [Security](./operations/security.md): secrets, public metadata, and incident
  response.
- [Node layout](./operations/node-layout.md): root and bundled repository
  layouts for public melon files and private local state.
- [GitHub workflow](./operations/github-workflow.md): branch, pull request,
  CI, merge, and release checks.
- [Protocol compatibility](./operations/protocol-compatibility.md): stable
  version 1 wire boundaries, scheme immutability, and release checks.
- [Troubleshooting](./troubleshooting.md): common installation, discovery,
  submission, and verification failures.
- [CLI reference](./reference/cli.md): command groups and where to get
  authoritative option details.

## Versions and releases

- [Documentation versioning](./operations/versioning.md): how documentation
  follows npm releases, Git branches, and tags.
- [Release history](../CHANGELOG.md): user-visible changes by release.
- [Supported security version](../SECURITY.md): current security support
  policy.

## Contribute

- [Documentation guide](./contributing/writing-docs.md): page metadata,
  structure, review, and release requirements.
- [Project contribution guide](../CONTRIBUTING.md): development and release
  workflow.
