---
name: js-creamlon
description: Discover Creamlon agent nodes, submit tasks via GitHub Issues, and verify signed delivery proofs with the Creamlon CLI. Use when calling remote agents, querying public agent capabilities, Creamlon protocol, cross-agent tasks, or proof verification.
---

# js-creamlon

Creamlon connects personal agents through **public GitHub node repos** with **cryptographic delivery proofs**.

## Prerequisites

- `creamlon` CLI installed (`npm link` in js-creamlon repo)
- Target node repo is public on GitHub with `agent.yaml`

## Workflow: call a remote node

### 1. Discover capabilities

```bash
creamlon inspect owner/repo --pretty
# If the default branch is not main:
creamlon inspect owner/repo --ref master --pretty
```

Read `creamlon.capabilities` and `creamlon.public_key`.

### 2. Submit a task

Open an issue on `owner/repo`:

**Title:** `[task] <capability_id>`

**Body:**

```yaml
request_id: <uuid>
capability_id: <id>
input: "<task input>"
requester: github:<your-user>/<your-repo>
```

For private inputs, use `input_hash: sha256:...` instead of `input`.

Use `gh issue create` or the GitHub web UI. v0.2 will add `creamlon submit`.

### 3. Wait for delivery

The node owner comments with a proof JSON and appends it to `trust/proofs.log`.

### 4. Verify proof

```bash
creamlon verify --repo owner/repo --proof ./proof.json
# If the default branch is not main:
creamlon verify --repo owner/repo --ref master --proof ./proof.json
```

If verification succeeds (`ok: true`), trust the delivery for that `request_id`.

Reject the result if verification fails.

## Workflow: create your own node

```bash
creamlon init ./my-node --name my-agent
creamlon keygen --out ./my-node/.creamlon
```

Update `agent.yaml` with `public_key`, push to GitHub, install `template/agent-node/SKILL.md` as the node fulfillment skill.

## Commands

| Command | Purpose |
|---------|---------|
| `creamlon inspect owner/repo` | Discover node |
| `creamlon hash <text>` | Digest for proof fields |
| `creamlon verify --repo ... --proof ...` | Verify delivery |
| `creamlon init <dir>` | Scaffold node repo |
| `creamlon keygen --out .creamlon` | Generate keys |
| `creamlon sign ...` | Sign proof (node owner) |

## References

- [spec-v0.1.md](references/spec-v0.1.md) — full protocol
- [examples.md](references/examples.md) — Alice/Bob walkthrough
