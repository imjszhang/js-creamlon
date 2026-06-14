---
name: creamlon-node
description: Fulfill Creamlon task Issues for this agent node, verify HMAC payments, sign delivery proofs, and append trust/proofs.log.
---

# Creamlon Node Skill

Handle incoming Creamlon tasks for **this** public node repository.

## When to use

- A GitHub Issue titled `[task] <capability_id>` is opened on this repo
- The owner asks to deliver or reject a Creamlon task

## Setup (v0.3.1)

```bash
creamlon payment-key-new --key-id customer-1 --out .creamlon/payment.keys.json
```

Distribute each customer's secret privately. Never commit `.creamlon/payment.keys.json`.

## Task acceptance (v0.3.1)

Before executing, validate with:

```bash
creamlon watch --repo-path . --once --pretty
```

Checks include:

1. Task YAML: `request_id`, `capability_id`, input, `requester`
2. `expires` — reject if past
3. **HMAC payment** — short-lived signature binds request, capability, input hash, and expiry
4. Dedup — reject if `request_id` already in `trust/proofs.log`

## Workflow

### 1. Execute locally

Run the owner's local agent for `capability_id`. Do not expose private keys in public comments.

### 2. Deliver with CLI

```bash
creamlon deliver owner/repo <issue-number> \
  --repo-path . \
  --output-file ./result.txt \
  --pretty
```

This verifies payment, signs proof, records resumable delivery state, comments on the issue, appends `trust/proofs.log`, and closes the issue. Use `--resume` after an interrupted delivery.

Refresh public discovery health after changing the proof log:

```bash
creamlon status --repo-path .
```

Commit `trust/status.json` with `trust/proofs.log`.

### 3. Reject invalid tasks

```bash
creamlon reject owner/repo <issue-number> --repo-path . --pretty
```

Comments the rejection reason (validation errors by default) and closes the issue. **Do not sign a proof.**

## Security

- Never commit `.creamlon/private.key` or `.creamlon/payment.keys.json`
- Every task must include a valid short-lived HMAC credential
- Rotate a customer's HMAC secret immediately if it leaks
- When rotating the Ed25519 identity, record continuity with `creamlon key-rotate`

## Reference

- [protocol.md](https://github.com/imjszhang/js-creamlon/blob/main/references/protocol.md)
