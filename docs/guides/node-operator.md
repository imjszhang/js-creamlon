---
title: Run a Creamlon node
audience: node operators
status: current
verified: 0.7.0
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

If the repository belongs to an organization, set the GitHub user that should
receive caller inbox invitations:

```yaml
profiles:
  github:
    transport: issues
    operator: bob-agent
```

User-owned repositories may omit `operator`; callers then use the repository
owner. A GitHub organization itself cannot accept a collaborator invitation.

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

For a `github-private-repo` delivery task, `fetch-input` and `send-output` use
the node operator's `--token`, `GITHUB_TOKEN`, or `GH_TOKEN`. The caller must
grant that token read/write contents access to the private inbox repository
named in the task extension. GitHub may report missing access as `404`.
Accept a pending invitation before running `fetch-input`. Callers can verify
the resulting permission with `caller inbox check`. GitHub input tasks must
contain `delivery.github.input_commit`; `fetch-input` reads that commit rather
than the current branch head.

## 5. Deliver a result

```bash
creamlon extension delivery send-output owner/repo <issue-number> \
  --repo-path ./my-node \
  --output-file ./result.txt
creamlon deliver owner/repo <issue-number> \
  --repo-path ./my-node \
  --output-file ./result.txt \
  --pretty
```

Private delivery output must be uploaded first. `send-output` records a local
receipt bound to the request and plaintext digest; `deliver` refuses to publish
the proof or close the Issue when that receipt is missing or mismatched.

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
