---
name: js-creamlon
description: Discover Creamlon agent nodes, submit tasks via GitHub Issues, and verify signed delivery proofs with the Creamlon CLI. Use when calling remote agents, querying public agent capabilities, Creamlon protocol, cross-agent tasks, or proof verification.
---

# js-creamlon

Creamlon connects personal agents through **public GitHub node repos** with **cryptographic delivery proofs**.

## Prerequisites

- `creamlon` CLI installed (`npm link` in js-creamlon repo)
- `GITHUB_TOKEN` for `submit` / `watch` / `deliver` / `reject` / `fetch-proof`
- Target node repo is public on GitHub with `agent.yaml`

## Workflow: call a remote node

### 1. Discover capabilities

```bash
creamlon inspect owner/repo --pretty
```

Read `creamlon.capabilities`, `creamlon.public_key`, and `payment_required`.

### 2. Submit a task

```bash
export GITHUB_TOKEN=ghp_...
creamlon submit owner/repo \
  --capability-id echo \
  --input "hello" \
  --requester github:your-user/your-repo \
  --request-id "$(uuidgen)" \
  --payment-json ./payment.json \
  --pretty
```

`payment.json` for paid nodes (v0.3 token):

```json
{
  "type": "token",
  "token": "<token-from-node-operator>",
  "request_id": "<same-as-submit-request-id>"
}
```

For private inputs use `--input-hash`. For large files use `--input-ref-url`.

### 3. Wait for delivery

The node comments with a proof JSON and appends it to `trust/proofs.log`.

### 4. Fetch and verify proof

```bash
creamlon fetch-proof owner/repo <issue#> --verify --pretty
# or
creamlon verify --repo owner/repo --proof ./proof.json
```

If verification succeeds (`ok: true`), trust the delivery for that `request_id`.

## Workflow: create your own node

```bash
creamlon init ./my-node --name my-agent
creamlon keygen --out ./my-node/.creamlon
creamlon token-new --out ./my-node/.creamlon/payment.token
```

Update `agent.yaml` with `public_key`, push to GitHub, install `template/agent-node/SKILL.md`.

### Fulfill tasks

```bash
creamlon watch owner/repo --repo-path ./my-node --once --pretty
creamlon deliver owner/repo <issue#> --repo-path ./my-node --output-file ./result.txt
creamlon reject owner/repo <issue#> --repo-path ./my-node --reason "invalid payment"
```

## Commands (v0.3)

| Command | Purpose |
|---------|---------|
| `creamlon submit owner/repo` | Create task Issue |
| `creamlon watch owner/repo --once` | Validate pending tasks (incl. payment) |
| `creamlon deliver owner/repo <issue#>` | Verify payment, sign proof, deliver |
| `creamlon reject owner/repo <issue#>` | Reject task and close Issue |
| `creamlon fetch-proof owner/repo <issue#>` | Extract proof from comments |
| `creamlon token-new` | Generate node payment token file |
| `creamlon inspect owner/repo` | Discover node |
| `creamlon verify --repo ... --proof ...` | Verify delivery |
| `creamlon hash` / `sign` / `keygen` / `init` | Crypto and scaffolding |

## References

- [spec-v0.3.md](references/spec-v0.3.md) — current protocol
- [spec-v0.2.md](references/spec-v0.2.md) — lifecycle fields
- [spec-v0.1.md](references/spec-v0.1.md) — proof format baseline
- [examples.md](references/examples.md) — Alice/Bob walkthrough
