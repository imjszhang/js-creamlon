# Creamlon Protocol v0.3

Creamlon v0.3 extends [v0.2](spec-v0.2.md) with **token payment verification** (anti-abuse gate), unified task acceptance checks, and new CLI commands `reject` and `fetch-proof`. **Proof format stays v0.1** — delivery trust remains Ed25519 signatures.

- **Discovery**: `agent.yaml`
- **Task mailbox**: GitHub Issues
- **Delivery receipt**: signed proof in Issue comments + `trust/proofs.log`
- **Anti-DDoS**: `payment_required: true` + token verification before deliver

## agent.yaml

Required `creamlon` block unchanged from v0.2.

### v0.3 payment fields (public)

```yaml
name: my-agent
description: What this node does
creamlon:
  version: "0.3"
  public_key: "<ed25519-base64url>"
  capabilities:
    - id: echo
      description: Echo the input text
  payment_required: true
  payment_instructions: "Contact the node operator for a token; submit payment.type token in the task Issue."
  payment:
    type: token
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `payment_required` | boolean | `false` | When `true`, tasks must include valid `payment` |
| `payment_instructions` | string | — | How callers obtain and submit payment |
| `payment.type` | string | — | v0.3 supports `token` only |

**Public nodes should set `payment_required: true`.** Use `false` only for private or fully trusted networks.

**Never put payment secrets in `agent.yaml`** — the file is public on GitHub.

### Node payment secrets (private)

The node stores valid tokens outside the repo. Resolution order:

1. CLI `--payment-token <value>`
2. Environment variable `CREAMLON_PAYMENT_TOKEN`
3. File `.creamlon/payment.token` (one token per line; supports rotation)

## Task Issue

Unchanged title and required fields from v0.2.

### payment (v0.3 token format)

```yaml
payment:
  type: token
  token: "<caller-submitted-token>"
  request_id: "<must match task request_id>"
```

- `request_id` in `payment` binds the token to this task (anti-replay / anti double-spend semantics).
- Node verifies: `type === token`, token matches a configured secret, `payment.request_id === task.request_id`.

## Node acceptance rules

Before executing or delivering, the node must:

1. Parse and validate task YAML.
2. Validate `agent.yaml` configuration.
3. Confirm `capability_id` is listed in `agent.yaml`.
4. Reject if `request_id` already appears in `trust/proofs.log` (dedup).
5. Reject if `expires` is in the past.
6. For deliver/reject: confirm Issue title is `[task] <capability_id>` and state is `open`.
7. Reject if `payment_required` and payment is missing or invalid.
8. If `payment` is present, verify per `payment.type` (v0.3: token verifier in js-creamlon).

Rejections: comment on the issue with reason, close issue. **No proof** on rejection.

## Proof

Unchanged from v0.1. Fields and canonical signing payload use `v: "0.1"`.

### Delivery steps

1. Post proof JSON as an Issue comment (fenced JSON block).
2. Append the same JSON line to `trust/proofs.log`.
3. Commit and push (node operator; CLI prints `next_steps`).
4. Close the issue.

## Security

All v0.1/v0.2 rules apply. Additionally:

- **Open nodes without payment are vulnerable to Issue spam** — use `payment_required: true` for public deployments.
- Token distribution is the operator's responsibility (paid access, invite-only, etc.). Leaked tokens bypass the gate until revoked.
- v0.3 ships a `token` verifier only; `evm` and other types may be added later as plugins.
- Security boundary: GitHub account trust; account compromise is out of scope.

## CLI reference (v0.3)

| Command | Purpose |
|---------|---------|
| `creamlon submit owner/repo` | Create task Issue via GitHub API |
| `creamlon watch owner/repo [--once]` | List and validate pending tasks |
| `creamlon deliver owner/repo <issue#>` | Verify payment, sign proof, comment, append proofs.log |
| `creamlon reject owner/repo <issue#> --reason "..."` | Comment rejection reason and close issue |
| `creamlon fetch-proof owner/repo <issue#> [--verify]` | Extract proof from Issue comments; optional signature verify |
| `creamlon token-new [--out path]` | Generate random payment token file |
| `creamlon inspect owner/repo [--ref main]` | Fetch capabilities |
| `creamlon hash <text>` | Compute digest |
| `creamlon sign ...` | Create proof |
| `creamlon verify --repo owner/repo [--ref main] --proof file` | Verify delivery |
| `creamlon keygen --out .creamlon` | Generate keys |
| `creamlon init <dir> --name my-agent` | Scaffold node repo |

`submit`, `watch`, `deliver`, `reject`, and `fetch-proof` require `GITHUB_TOKEN` (or `--token`).
