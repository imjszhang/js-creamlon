---
name: creamlon-node
description: Create and operate a Creamlon GitHub node, validate incoming task Issues, execute declared capabilities locally, reject invalid tasks, publish Ed25519 delivery proofs, audit proof logs, and rotate node identity keys.
---

# Creamlon Node

Run the published CLI through npm:

```bash
npx --yes js-creamlon@0.1.0 help
```

Require Node.js 18 or newer. Use `GITHUB_TOKEN`, `GH_TOKEN`, or `--token` for
GitHub operations. Never commit `.creamlon/` or expose private keys and HMAC
secrets.

## Create

```bash
npx --yes js-creamlon@0.1.0 init ./my-node --name my-node
npx --yes js-creamlon@0.1.0 keygen --out ./my-node/.creamlon
```

Put the generated public key in `creamlon.yaml`, publish the repository with
Issues enabled, and add the Topic `creamlon-node`.

## Validate

```bash
npx --yes js-creamlon@0.1.0 watch owner/repo \
  --repo-path . \
  --once \
  --pretty
```

Execute only tasks reported as valid. Validation covers schema, Issue binding,
capability, expiry, optional authorization, and duplicate request IDs.

## Deliver

Execute the capability locally and write its result to a file:

```bash
npx --yes js-creamlon@0.1.0 deliver owner/repo <issue-number> \
  --repo-path . \
  --output-file ./result.txt \
  --pretty
```

Use `--resume` after interruption. Then refresh public health:

```bash
npx --yes js-creamlon@0.1.0 status --repo-path .
```

Commit `trust/proofs.log` and `trust/status.json`.

## Reject

```bash
npx --yes js-creamlon@0.1.0 reject owner/repo <issue-number> \
  --repo-path . \
  --pretty
```

Reject invalid or unsupported tasks without signing a proof.

Read [references/operations.md](references/operations.md) for authorization,
delivery recovery, auditing, and key rotation.
