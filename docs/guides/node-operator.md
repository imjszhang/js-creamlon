---
title: Run a Creamlon node
audience: node operators
status: current
verified: 0.4.0
---

# Run a Creamlon node

A Creamlon node is a public GitHub repository that advertises capabilities,
accepts structured Issue tasks, and signs delivery proofs.

## 1. Scaffold and generate identity

```bash
creamlon init ./my-node --name my-node
creamlon keygen --out ./my-node/.creamlon
```

Copy the generated public key into `creamlon.yaml`. Keep `.creamlon/` local and
private.

## 2. Publish the repository

The repository must:

1. Be public, non-forked, and non-archived.
2. Have GitHub Issues enabled.
3. Publish a valid root-level `creamlon.yaml` on its default branch.
4. Use the GitHub Topic `creamlon-node`.

Keep capability IDs, media types, access requirements, extension declarations,
and status accurate because callers consume the manifest directly.

## 3. Configure access

Capabilities without `access` are free. For one-time credential access, declare
`access.mode: credential` and the `voucher-hmac-v1` credential profile, then
create a credential:

```bash
creamlon credential create \
  --repo-path ./my-node \
  --capability-id <capability-id> \
  --pretty
```

Deliver the complete credential through a private channel. Creamlon verifies
task authorization and redemption, not payment.

## 4. Validate pending tasks

```bash
creamlon watch owner/repo \
  --repo-path ./my-node \
  --once \
  --pretty
```

Execute only tasks reported as valid. Reject malformed, unauthorized, expired,
or unsupported tasks without signing a delivery proof.

## 5. Deliver a result

```bash
creamlon deliver owner/repo <issue-number> \
  --repo-path ./my-node \
  --output-file ./result.txt \
  --pretty
```

If publication is interrupted, repeat with `--resume`. Delivery is designed to
continue through the `prepared`, `commented`, `logged`, and `closed` states
without redeeming a credential twice.

After delivery, refresh status and commit public trust records:

```bash
creamlon status --repo-path ./my-node
```

Commit `trust/proofs.log`, `trust/status.json`, and
`trust/redemptions.log` when credential redemptions occurred. Never commit
credential stores or private keys.

## Routine operations

- Run `creamlon audit --repo-path ./my-node` after trust-log changes.
- Use `credential list` and `credential revoke` without exposing secrets.
- Record identity changes with `key-rotate` before discarding the old key.
- Read [security guidance](../operations/security.md) before production use.
- Use [troubleshooting](../troubleshooting.md) for recovery and validation
  failures.
