---
name: creamlon-node
description: Validate Creamlon Issue tasks, execute local capabilities, and publish signed delivery proofs.
---

# Creamlon Node Skill

Use this skill for Issues titled `[task] <capability_id>`.

## Validate

```bash
npx --yes creamlon@0.6.0 watch owner/repo --repo-path . --once --pretty
```

Only execute tasks reported as valid. Validation covers the version 1 task
schema, Issue binding, capability, expiry, optional authorization, and duplicate
request IDs.

## Private delivery tasks

When a task includes `extensions.delivery`, decrypt input before execution and
upload encrypted output before the core `deliver` step:

```bash
npx --yes creamlon@0.6.0 extension delivery fetch-input owner/repo <issue-number> \
  --repo-path . \
  --output-file ./input.bin \
  --input-get-url <private-get-url-if-presigned>

npx --yes creamlon@0.6.0 extension delivery send-output owner/repo <issue-number> \
  --repo-path . \
  --output-file ./result.txt
```

Generate delivery keys once with `extension delivery keygen --out .creamlon` and
publish `receive_public_key` in `creamlon.yaml`.

## Deliver

Run the requested capability locally and write its result to a file:

```bash
npx --yes creamlon@0.6.0 deliver owner/repo <issue-number> \
  --repo-path . \
  --output-file ./result.txt \
  --pretty
```

This signs the input/output binding, comments on the Issue, appends
`trust/proofs.log`, and closes the Issue. Use `--resume` if delivery was
interrupted.

Refresh discovery health afterward:

```bash
npx --yes creamlon@0.6.0 status --repo-path .
```

Commit `trust/proofs.log` and `trust/status.json`.

## Reject

```bash
npx --yes creamlon@0.6.0 reject owner/repo <issue-number> --repo-path . --pretty
```

Reject invalid or unsupported tasks without signing a proof.

## Security

- Never commit `.creamlon/` or private keys.
- Do not expose private task data in Issue comments.
- If authorization is enabled, rotate a leaked HMAC secret immediately.
- Record Ed25519 identity changes with `npx --yes creamlon@0.6.0 key-rotate`.
