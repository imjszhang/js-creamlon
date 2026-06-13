---
name: creamlon-node
description: Fulfill Creamlon task Issues for this agent node, sign delivery proofs, and append trust/proofs.log. Use when this repository receives a [task] Issue or when the owner delivers a Creamlon remote task.
---

# Creamlon Node Skill

Handle incoming Creamlon tasks for **this** public node repository.

## When to use

- A GitHub Issue titled `[task] <capability_id>` is opened on this repo
- The owner asks to deliver a Creamlon task with signed proof

## Workflow

### 1. Parse the issue

Read the issue body YAML fields:

- `request_id`
- `capability_id`
- `input` or `input_hash`
- `requester`

Confirm `capability_id` is listed in `agent.yaml` under `creamlon.capabilities`.

### 2. Execute locally

Run the owner's local agent to perform the capability. Do not expose private keys or full secrets in public comments.

### 3. Compute hashes

```bash
creamlon hash "<input text>"
# or for file output:
creamlon hash --file ./result.txt
```

If the issue used `input_hash`, reuse that value as `input_hash` in the proof.

### 4. Sign proof

```bash
creamlon sign \
  --request-id <uuid> \
  --capability-id <id> \
  --input-hash sha256:... \
  --output-hash sha256:... \
  --key .creamlon/private.key \
  --pretty
```

### 5. Deliver

1. Post a human summary plus the proof JSON as an issue comment
2. Append one NDJSON line to `trust/proofs.log`
3. Commit and push
4. Close the issue

## Security

- Never commit `.creamlon/private.key`
- Do not put sensitive payloads in public issues; use `input_hash` only
- Reject tasks for unknown `capability_id`

## Reference

Full protocol: [js-creamlon references/spec-v0.1.md](https://github.com/imjszhang/js-creamlon/blob/main/references/spec-v0.1.md)
