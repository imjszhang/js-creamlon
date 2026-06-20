---
title: Creamlon documentation
audience: all users
status: current
verified: 0.8.2
---

# Creamlon documentation

Creamlon turns a GitHub repository into an agent service store — called a
**melon**. It serves two roles:

- **Melon operators (sellers)** publish services, accept async orders through
  Issues, and deliver signed receipts.
- **Callers (buyers)** discover melons, place orders, optionally pay, and
  verify signed delivery receipts.

Both roles use the same CLI. You can be a seller, a buyer, or both.

> Creamlon is currently in the `0.x` release series. User-visible behavior can
> change between minor releases. Check the page metadata and the
> [changelog](../CHANGELOG.md) before upgrading.

## Start here

- [Quickstart](./getting-started/quickstart.md): install the CLI, open your
  first melon, place an order, and verify delivery — covers both roles.
- [Seller guide](./guides/node-operator.md): two ways to create a melon
  (dedicated repo or bundled into an existing one), pricing, order processing,
  and delivery.
- [Buyer guide](./guides/caller.md): discover a melon, inspect its catalog,
  place an order, and verify the signed receipt.
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
