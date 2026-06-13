# Creamlon Protocol v0.1

Creamlon lets personal agents expose **verifiable capabilities** through a public GitHub repository.

- **Discovery**: `agent.yaml`
- **Task mailbox**: GitHub Issues
- **Delivery receipt**: signed proof in Issue comments + `trust/proofs.log`

The `creamlon` CLI in [js-creamlon](https://github.com/imjszhang/js-creamlon) is the reference implementation.

## agent.yaml

Compatible with Skill-style metadata. Required `creamlon` block:

```yaml
name: my-agent
description: What this node does
creamlon:
  version: "0.1"
  public_key: "<ed25519-base64url>"
  capabilities:
    - id: echo
      description: Echo the input text
```

- Repository URL (`github:owner/repo`) is the node identity.
- Issues are the task channel; no extra fields required.

## Task Issue

**Title:** `[task] <capability_id>`

**Body** (YAML block):

```yaml
request_id: <uuid>
capability_id: echo
input: "hello"
requester: github:alice/caller-repo
```

For sensitive payloads use `input_hash` instead of `input`:

```yaml
request_id: <uuid>
capability_id: code_review
input_hash: sha256:...
requester: github:alice/caller-repo
```

- Open issue = pending
- Closed issue = done or rejected

## Proof

One NDJSON line per delivery. Fields:

| Field | Description |
|-------|-------------|
| `v` | Protocol version (`"0.1"`) |
| `request_id` | Matches the task issue |
| `capability_id` | Capability executed |
| `input_hash` | `sha256:...` of request input |
| `output_hash` | `sha256:...` of deliverable |
| `completed_at` | ISO 8601 UTC timestamp |
| `sig` | Ed25519 signature (base64url) |

### Canonical signing payload

Sign the UTF-8 bytes of this JSON string (no spaces, fixed key order):

```json
{"v":"0.1","request_id":"...","capability_id":"...","input_hash":"sha256:...","output_hash":"sha256:...","completed_at":"..."}
```

Keys must appear exactly in this order: `v`, `request_id`, `capability_id`, `input_hash`, `output_hash`, `completed_at`.

Algorithm: Ed25519 raw signature over the canonical string. Public key in `agent.yaml` is SPKI-derived 32-byte raw key encoded as base64url (as produced by `creamlon keygen`).

### Delivery steps

1. Post proof JSON as an Issue comment (human-readable summary optional above it).
2. Append the same JSON line to `trust/proofs.log`.
3. Commit and push.
4. Close the issue.

## Hash format

`sha256:<hex>` where `<hex>` is SHA-256 of UTF-8 text.

CLI: `creamlon hash "text"` or `creamlon hash --file path`. Multi-word text is joined with spaces.

## Security

- Never commit private keys or secrets to the public node repo.
- Do not put sensitive source code in Issues or public comments; use `input_hash` only.
- Proof binds to `request_id`; callers should reject duplicate/replayed proofs for the same request.
- `verify` checks protocol version `v === "0.1"`, `sha256:<64 hex>` hash format, and Ed25519 signature.
- v0.1 assumes **manual acceptance** of tasks by the node owner.

## proofs.log

Append-only NDJSON ledger. Lines starting with `#` and blank lines are ignored when parsing.

## CLI reference

| Command | Purpose |
|---------|---------|
| `creamlon inspect owner/repo [--ref main]` | Fetch capabilities |
| `creamlon hash <text>` | Compute digest |
| `creamlon sign ...` | Create proof |
| `creamlon verify --repo owner/repo [--ref main] --proof file` | Verify delivery |
| `creamlon keygen --out .creamlon` | Generate keys |
| `creamlon init <dir> --name my-agent` | Scaffold node repo |
