---
name: creamlon-node
description: Fulfill Creamlon task Issues for this agent node, sign delivery proofs, and append trust/proofs.log. Use when this repository receives a [task] Issue or when the owner delivers a Creamlon remote task.
---

# Creamlon Node Skill

Handle incoming Creamlon tasks for **this** public node repository.

## When to use

- A GitHub Issue titled `[task] <capability_id>` is opened on this repo
- The owner asks to deliver a Creamlon task with signed proof

## Task acceptance (v0.2)

Before executing, check:

1. Parse issue body YAML: `request_id`, `capability_id`, input (`input` / `input_hash` / `input_ref`), `requester`
2. Optional `expires` — reject if past
3. Optional `payment` — if `agent.yaml` has `payment_required: true`, verify per `payment_instructions` (node implements verification; js-creamlon has no built-in validators)
4. Dedup: reject if `request_id` already in `trust/proofs.log`

Use `creamlon watch --repo-path . --once` to list pending tasks with validation errors.

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

This signs proof, comments on the issue, appends `trust/proofs.log`, and closes the issue. Then commit and push.

### 3. Rejections

On reject (expired, duplicate, invalid payment): comment reason, close issue. **Do not sign a proof.**

## Security

- Never commit `.creamlon/private.key`
- Use `input_hash` for sensitive payloads
- Payment verification is your responsibility when `payment_required: true`

## Reference

- [spec-v0.2.md](https://github.com/imjszhang/js-creamlon/blob/main/references/spec-v0.2.md)
