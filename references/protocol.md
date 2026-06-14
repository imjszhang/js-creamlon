# Creamlon Protocol

Protocol version: `1`

Creamlon defines a small identity and proof layer for agent task delegation.
GitHub is the official version 1 profile.

## Manifest

A node publishes one root-level, machine-readable `creamlon.yaml`.

```yaml
version: "1"
name: echo-node
description: Echo text
identity:
  type: ed25519
  public_key: "<base64url-public-key>"
status: available
capabilities:
  - id: echo
    description: Echo text
    input:
      media_types: [text/plain]
    output:
      media_types: [text/plain]
    access:
      mode: credential
      units: 1
profiles:
  github:
    transport: issues
  credential:
    scheme: voucher-hmac-v1
    instructions: Obtain a one-time task credential from the operator.
extensions: {}
```

Core and profile fields are strict. `extensions` is the only open namespace.
Unknown protocol versions are rejected.

`access` is optional. Its absence is equivalent to free access. Version 1
supports:

- `mode: free`
- `mode: credential` with `units: 1`

A manifest using credential access must declare
`profiles.credential.scheme: voucher-hmac-v1`.

## GitHub Profile

A discoverable node:

1. Is a public, non-fork, non-archived repository with Issues enabled.
2. Adds the GitHub Topic `creamlon-node`.
3. Publishes a valid `creamlon.yaml` on its default branch.

Discovery may read these optional public trust files:

- `trust/proofs.log`
- `trust/key-rotations.log`
- `trust/status.json`

They provide self-published evidence. Proof counts never affect ranking, and a
rotation chain is trusted only when anchored to a caller's previously saved key.

## Task

A task is a GitHub Issue titled `[task] <capability_id>` with this YAML body:

```yaml
version: "1"
request_id: 550e8400-e29b-41d4-a716-446655440000
capability_id: echo
requester: github:alice/caller
input:
  media_type: text/plain
  value: hello
expires: 2026-12-31T00:00:00Z
credential:
  scheme: voucher-hmac-v1
  credential_id: J7K4QP2M
  authorization: "<base64url-hmac-sha256>"
```

`input` contains `media_type` and exactly one location:

- `value`: inline UTF-8 text
- `url`: HTTP or HTTPS URL
- `digest`: existing `sha256:<64 lowercase hex>` commitment

The input digest is the supplied digest or SHA-256 of the UTF-8 `value`/`url`.

## Task Credentials

A task credential is a secret supplied by the node operator through any
external channel:

```text
crv1_<credential_id>.<256-bit-base64url-secret>
```

Creamlon does not specify how the caller obtains it. It may represent a paid
order, subscription entitlement, internal quota, invitation, or gift.

The complete credential never appears in a public Issue. The caller constructs
the task first, then publishes only its ID and an HMAC authorization.

The canonical credential intent is JSON with this exact field order:

```json
{"version":"1","scheme":"voucher-hmac-v1","node_identity":"...","credential_id":"...","request_id":"...","capability_id":"...","input_digest":"sha256:...","expires":"..."}
```

`authorization` is:

```text
base64url(HMAC-SHA256(credential_secret, canonical_credential_intent))
```

Credential-backed tasks require `expires`. The binding prevents a published
authorization from being reused with another node, credential, request,
capability, input, or expiry.

The node stores credential secrets privately in
`.creamlon/credentials.json`. Successful redemption is recorded without the
secret in `trust/redemptions.log`:

```json
{"version":"1","request_id":"...","credential_id":"...","credential_digest":"sha256:...","task_intent_digest":"sha256:...","capability_id":"echo","redeemed_at":"..."}
```

The node rejects unknown, expired, revoked, capability-mismatched, incorrectly
authorized, or previously redeemed credentials. Redemption and delivery state
updates run under the node delivery lock. A credential is consumed when
delivery is accepted, even if later publication requires `--resume`.

Credential verification proves task access, not payment. Creamlon does not
inspect orders, amounts, currencies, refunds, or payment providers.

## Authorization Profile

Authorization is optional. A node that requires it declares:

```yaml
profiles:
  github:
    transport: issues
  authorization:
    scheme: hmac-sha256
    instructions: Contact the operator for a key.
```

The task then adds:

```yaml
authorization:
  scheme: hmac-sha256
  key_id: alice
  expires: 2026-06-20T00:00:00Z
  signature: "<base64url-hmac-sha256>"
```

The HMAC binds `version`, `scheme`, `key_id`, `request_id`, `capability_id`,
`input_digest`, and authorization expiry in that exact JSON key order.

## Acceptance

Before delivery, a GitHub node verifies:

1. Manifest and task schemas.
2. Issue title, open state, capability, and task expiry.
3. Authorization when the node declares that profile.
4. Absence of the request ID in `trust/proofs.log`.
5. Credential authorization and unused status when the capability requires it.

## Proof

The node signs this canonical JSON field order with Ed25519:

```json
{"version":"1","request_id":"...","capability_id":"echo","input_digest":"sha256:...","output_digest":"sha256:...","credential_digest":"sha256:...","task_intent_digest":"sha256:...","completed_at":"..."}
```

The two credential fields are present together only for credential-backed
tasks. Their absence preserves the original free-task canonical payload.

The proof adds a base64url `signature` field. A proof fetched from GitHub is
accepted only when its signature is valid, its task binding matches, its
credential intent matches when present, and its comment author is trusted for
the repository.

## Delivery

Delivery is resumable and idempotent:

```text
prepared -> commented -> logged -> closed
```

For credential-backed tasks, redemption is first appended to
`trust/redemptions.log`. The proof is posted to the Issue, appended to
`trust/proofs.log`, and the Issue is closed. `creamlon deliver --resume`
continues interrupted delivery without redeeming the credential twice.

YAML inputs use the core schema. Duplicate keys, aliases, unknown core fields,
and documents larger than 64 KiB are rejected.
