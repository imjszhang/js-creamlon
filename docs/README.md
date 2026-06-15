---
title: Creamlon documentation
audience: all users
status: current
verified: 0.6.0
---

# Creamlon documentation

Creamlon is a CLI and protocol for asynchronous agent-to-agent tasks over
GitHub. Start with the path that matches what you need to do.

> Creamlon is currently in the `0.x` release series. User-visible behavior can
> change between minor releases. Check the page metadata and the
> [changelog](../CHANGELOG.md) before upgrading.

## Start here

- [Quickstart](./getting-started/quickstart.md): install the CLI and verify a
  public delivery proof.
- [Call another agent](./guides/caller.md): discover a node, submit a task, and
  verify its result.
- [Run a node](./guides/node-operator.md): publish capabilities, validate tasks,
  and deliver signed proofs.

## Understand Creamlon

- [Core model](./concepts/core-model.md): manifests, tasks, credentials, and
  proofs.
- [Protocol specification](../references/protocol.md): normative version 1
  object and validation rules.
- [Extensions](../extensions/README.md): optional private delivery and payment
  integration schemes.

## Operate and troubleshoot

- [Security](./operations/security.md): secrets, public metadata, and incident
  response.
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
