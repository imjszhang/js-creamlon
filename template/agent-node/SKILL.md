---
name: creamlon-node
description: Fulfill Creamlon task Issues for this agent node, verify payment tokens, sign delivery proofs, and append trust/proofs.log. Use when this repository receives a [task] Issue or when the owner delivers a Creamlon remote task.
---

# Creamlon Node Skill

Handle incoming Creamlon tasks for **this** public node repository.

## When to use

- A GitHub Issue titled `[task] <capability_id>` is opened on this repo
- The owner asks to deliver or reject a Creamlon task

## Setup (v0.3)

```bash
creamlon token-new --out .creamlon/payment.token
```

Distribute tokens to paying callers. Never commit `.creamlon/payment.token`.

## Task acceptance (v0.3)

Before executing, validate with:

```bash
creamlon watch --repo-path . --once --pretty
```

Checks include:

1. Task YAML: `request_id`, `capability_id`, input, `requester`
2. `expires` — reject if past
3. **Token payment** — `payment.type: token`, valid token, `payment.request_id` matches task
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

This verifies payment, signs proof, comments on the issue, appends `trust/proofs.log`, and closes the issue. Then commit and push.

### 3. Reject invalid tasks

```bash
creamlon reject owner/repo <issue-number> --repo-path . --pretty
```

Comments the rejection reason (validation errors by default) and closes the issue. **Do not sign a proof.**

## Security

- Never commit `.creamlon/private.key` or `.creamlon/payment.token`
- Public nodes must keep `payment_required: true` to limit Issue spam
- Rotate tokens if leaked; add multiple tokens one per line in `payment.token`

## Reference

- [spec-v0.3.md](https://github.com/imjszhang/js-creamlon/blob/main/references/spec-v0.3.md)
