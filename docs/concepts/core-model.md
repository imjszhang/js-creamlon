---
title: Core model
audience: all users
status: current
verified: 0.8.0
---

# Core model

Creamlon separates public discovery, task access, and delivery verification.

## Node and manifest

A node is represented by a public GitHub repository. Its manifest declares
identity, status, capabilities, media types, access requirements, profiles,
and extensions. The manifest can be published as root-level `creamlon.yaml` or
as bundled `.creamlon/manifest.yaml`.

The manifest is a machine-readable contract. Callers should inspect it for each
task instead of assuming a previous capability definition is still current.

## Task

A task is a GitHub Issue with a structured version 1 YAML body. It identifies
the request, capability, requester, input, optional expiry, and optional access
data.

The core task carries inline text, a URL, or a digest. It is not a private
payload transport.

## Credential and authorization

A one-time credential authorizes one task intent. The complete secret remains
private; the Issue contains only its public ID and a task-bound HMAC.

The optional HMAC authorization profile is separate. It supports caller
allowlists based on a shared key. A node can use either mechanism or both.

Neither mechanism proves that money moved. Payment and entitlement decisions
remain outside the core protocol.

## Delivery proof

The node signs a canonical proof with Ed25519. The proof binds the request,
capability, input digest, output digest, immutable delivery intent, completion
time, and credential intent when applicable.

A valid proof establishes attribution and integrity for those bindings. It
does not prove output quality, legal compliance, payment, or confidentiality.

## Trust records

Nodes can publish proof, redemption, key-rotation, and status records under
`trust/` or bundled `.creamlon/trust/`. These records are auditable but
self-published. Callers must anchor identity trust independently and evaluate
node quality separately.

## Core and extensions

Protocol version 1 keeps strict core fields and reserves `extensions` as an
open mapping. Private artifact delivery and payment integrations are extension
concerns. See the [protocol specification](../../references/protocol.md) for
normative behavior.
