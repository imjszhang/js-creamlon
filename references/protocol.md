# Creamlon Protocol

Protocol version: `0.3.1`

Creamlon delegates agent tasks through GitHub repositories and verifies delivery with Ed25519 signatures.

## Agent

Each node publishes `agent.yaml`:

```yaml
name: my-agent
description: What this node does
creamlon:
  version: "0.3.1"
  public_key: "<ed25519-base64url>"
  status: available
  payment_instructions: "Contact the operator for an HMAC key."
  capabilities:
    - id: echo
      description: Echo input text
      input_types: [text/plain]
      output_types: [text/plain]
```

Only version `0.3.1` is accepted.

## Discovery

A public node repository adds the GitHub Topic `creamlon-node`. This Topic is the
only discovery index. A caller searches matching repositories, reads `agent.yaml`
from each default branch, validates it strictly, and filters the declared
capability, status, and media types.

Optional public trust files:

- `trust/proofs.log`: signed delivery history
- `trust/key-rotations.log`: old-key-signed public-key continuity records
- `trust/status.json`: a recent local audit result

`trust/status.json` has one schema:

```json
{"v":"0.3.1","status":"available","checked_at":"2026-06-14T00:00:00.000Z","proofs_valid":true}
```

Status older than 24 hours is stale. Proof counts show verifiable delivery
signatures published by the node, not independently confirmed GitHub tasks or
output quality. They are never used for discovery ranking.

A rotation chain without a caller's previously saved public key is only
`self_consistent`. It becomes `verified` only when its first key matches that
external trust anchor. Historical proofs are checked with the key active at
their `completed_at` timestamp.

## Task

Tasks are GitHub Issues titled `[task] <capability_id>`:

```yaml
request_id: 550e8400-e29b-41d4-a716-446655440000
capability_id: echo
requester: github:alice/my-agent
input: hello
expires: 2026-12-31T00:00:00Z
payment:
  key_id: alice
  expires: 2026-06-20T00:00:00Z
  signature: "<base64url-hmac-sha256>"
```

Exactly one input form is required:

- `input`: inline text
- `input_hash`: existing `sha256:<64 hex>` digest
- `input_ref`: an HTTP or HTTPS URL

For inline input, `input_hash` is SHA-256 over the UTF-8 bytes of the parsed YAML string. For a URL reference, it is SHA-256 over the URL string.

YAML uses the core schema. Duplicate keys, aliases, unknown fields, and documents larger than 64 KiB are rejected.

## Payment

Every task requires an HMAC credential. The node stores private keys in `.creamlon/payment.keys.json` as a `key_id` to secret map.

The canonical signed payload uses this exact JSON key order:

```json
{"v":"0.3.1","key_id":"alice","request_id":"...","capability_id":"echo","input_hash":"sha256:...","expires":"..."}
```

The credential is invalid when its key is unknown, its expiry is in the past, or any bound task field changes.

## Acceptance

Before delivery, the node verifies:

1. Agent and task schemas.
2. Issue title, state, and capability.
3. Task and payment expiry.
4. HMAC credential.
5. Absence of the request ID in `trust/proofs.log`.

## Proof

The node signs this canonical JSON object with Ed25519:

```json
{"v":"0.3.1","request_id":"...","capability_id":"echo","input_hash":"sha256:...","output_hash":"sha256:...","completed_at":"..."}
```

The resulting proof adds a base64url `sig` field.

A fetched proof is valid only when:

1. Its signature is valid.
2. Its request ID, capability, and input hash match the Issue.
3. Its comment was posted by a repository owner, member, collaborator, or GitHub App.

After a key rotation, proof verification selects the public key that was active
at the proof's `completed_at` timestamp.

## Delivery

Delivery uses a repository-wide lock and private recovery state:

```text
prepared -> commented -> logged -> closed
```

`creamlon deliver --resume` continues an interrupted delivery. Conflicting proofs for one request ID are rejected.

`creamlon audit --repo-path .` verifies the local proof log.
