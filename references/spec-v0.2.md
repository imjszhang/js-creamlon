# Creamlon Protocol v0.2

Creamlon v0.2 extends [v0.1](spec-v0.1.md) with optional task lifecycle fields (from GAP) and CLI automation. **Proof format stays v0.1** — delivery trust remains Ed25519 signatures.

- **Discovery**: `agent.yaml`
- **Task mailbox**: GitHub Issues
- **Delivery receipt**: signed proof in Issue comments + `trust/proofs.log`

## agent.yaml

Required `creamlon` block (unchanged from v0.1):

```yaml
name: my-agent
description: What this node does
creamlon:
  version: "0.2"
  public_key: "<ed25519-base64url>"
  capabilities:
    - id: echo
      description: Echo the input text
```

Optional v0.2 fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `payment_required` | boolean | `false` | When `true`, tasks must include `payment` |
| `payment_instructions` | string | — | How to pay; must explain binding `request_id` in payment metadata |

When `payment_required: true`, `payment_instructions` should be set.

## Task Issue

**Title:** `[task] <capability_id>`

**Body** (YAML block). Required fields:

```yaml
request_id: <uuid>
capability_id: echo
requester: github:alice/caller-repo
```

**Input** — exactly one of:

```yaml
input: "hello"
# or
input_hash: sha256:...
# or
input_ref:
  type: url
  value: "https://example.com/large-doc.pdf"
```

Optional v0.2 fields:

```yaml
expires: 2026-06-20T00:00:00Z
payment:
  type: evm
  txid: "0x..."
```

### input_ref

v0.2 supports `type: url` only. The input hash for proofs is `sha256:` of the URL string (UTF-8), same as `creamlon hash "<url>"`.

### expires

ISO 8601 UTC. Nodes must reject tasks where `expires` is in the past.

### payment

Optional free-form object. When present, the sender **must** bind `request_id` in payment metadata (e.g. chain tx data, invoice description, Stripe metadata). Nodes verify payment per `payment_instructions`; **js-creamlon does not ship payment validators**.

Anti-double-spend: payment proof metadata must reference the same `request_id` as the task.

## Node acceptance rules

Before executing a task, the node must:

1. Parse and validate task YAML.
2. Confirm `capability_id` is listed in `agent.yaml`.
3. Reject if `request_id` already appears in `trust/proofs.log` (dedup).
4. Reject if `expires` is past.
5. Reject if `payment_required` and `payment` is missing.
6. If `payment` is present, verify per `payment_instructions` (node implementation).

Rejections: comment on the issue with reason, close issue. **No proof** on rejection.

## Proof

Unchanged from v0.1. Fields and canonical signing payload use `v: "0.1"`.

### Delivery steps

1. Post proof JSON as an Issue comment (human-readable summary optional above it).
2. Append the same JSON line to `trust/proofs.log`.
3. Commit and push.
4. Close the issue.

## Security

All v0.1 rules apply. Additionally:

- Callers and nodes should reject duplicate `request_id` tasks.
- Payment verification is the node owner's responsibility when `payment_required: true`.
- Security boundary: GitHub account trust; account compromise is out of scope.

## CLI reference (v0.2)

| Command | Purpose |
|---------|---------|
| `creamlon submit owner/repo` | Create task Issue via GitHub API |
| `creamlon watch owner/repo [--once]` | List and validate pending tasks |
| `creamlon deliver owner/repo <issue#>` | Sign proof, comment, append proofs.log |
| `creamlon inspect owner/repo [--ref main]` | Fetch capabilities |
| `creamlon hash <text>` | Compute digest |
| `creamlon sign ...` | Create proof |
| `creamlon verify --repo owner/repo [--ref main] --proof file` | Verify delivery |
| `creamlon keygen --out .creamlon` | Generate keys |
| `creamlon init <dir> --name my-agent` | Scaffold node repo |

`submit`, `watch`, and `deliver` require `GITHUB_TOKEN` (or `--token`).
