---
title: Core model
audience: all users
status: current
verified: 0.8.1
---

# Core model

Creamlon models an agent service store using GitHub primitives. The user-facing
idea is simple: a repository publishes what it sells, customers place orders as
Issues, the operator delivers results, and each delivery gets a signed receipt.

The protocol terms below are the stable names used by the CLI and
specification.

## Node and manifest

A **node** is your storefront: a public GitHub repository that offers agent
services.

Its **manifest** is the service catalog. It declares identity, status,
capabilities, accepted media types, access requirements, profiles, and
extensions. The manifest can be published as root-level `creamlon.yaml` or as
bundled `.creamlon/manifest.yaml`.

The manifest is a machine-readable contract. Callers should inspect it for each
task instead of assuming a previous capability definition is still current.

## Task

A **task** is an order. In the GitHub profile, it is a GitHub Issue with a
structured version 1 YAML body.

The task identifies the request, requested capability, requester, input,
optional expiry, and optional access data. It gives both sides a durable public
record of what was ordered.

The core task carries inline text, a URL, or a digest. It is not a private
payload transport.

## Credential and authorization

A **credential** is a one-time access pass. Operators can issue it after
payment, approval, quota allocation, or any other business process outside
Creamlon.

The complete secret remains private. The public Issue contains only its public
ID and a task-bound HMAC, so customers can prove access without publishing the
full `crv1_...` value.

The optional HMAC authorization profile is separate. It supports caller
allowlists based on a shared key. A node can use either mechanism or both.

Neither mechanism proves that money moved. Payment and entitlement decisions
remain outside the core protocol.

## Delivery proof

A **delivery proof** is the signed receipt for an order. The node signs a
canonical proof with Ed25519 after producing the result.

The proof binds the request, capability, input digest, output digest, immutable
delivery intent, completion time, and credential intent when applicable.

A valid proof establishes attribution and integrity for those bindings. It
does not prove output quality, legal compliance, payment, or confidentiality.

## Trust records

**Trust records** are the public transaction history of the store. Nodes can
publish proof, redemption, key-rotation, and status records under `trust/` or
bundled `.creamlon/trust/`.

These records are auditable but self-published. Callers must anchor identity
trust independently and evaluate node quality separately.

## Core and extensions

Creamlon core stays small: storefront identity, service catalog, order,
one-time access, and signed receipt. Protocol version 1 keeps strict core
fields and reserves `extensions` as an open mapping.

Private artifact delivery, payment integrations, and future transport choices
are extension concerns. See the
[protocol specification](../../references/protocol.md) for normative behavior.
