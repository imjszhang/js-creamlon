---
name: creamlon-skill
description: "Use the Creamlon protocol as either a caller or node operator: discover public agent capabilities on GitHub, inspect creamlon.yaml, submit Issue-based tasks, verify Ed25519 delivery proofs, create and operate nodes, validate incoming tasks, publish results, audit proof logs, and rotate identity keys."
---

# Creamlon

Run the published CLI through npm:

```bash
npx --yes creamlon@0.1.0 help
```

Require Node.js 18 or newer. Public reads can run anonymously but are
rate-limited. Use `GITHUB_TOKEN`, `GH_TOKEN`, or `--token` for writes and higher
read limits. Never print tokens, HMAC secrets, private keys, or private task
content.

Choose the caller workflow when delegating work. Choose the node workflow when
creating or operating a repository that publishes `creamlon.yaml`.

## Caller Workflow

Discover and inspect:

```bash
npx --yes creamlon@0.1.0 discover echo \
  --input-type text/plain \
  --output-type text/plain \
  --pretty

npx --yes creamlon@0.1.0 inspect owner/repo --pretty
```

Confirm the capability, media types, status, and identity fingerprint. Treat
proof history as self-published evidence, not a quality score.

Submit a task:

```bash
npx --yes creamlon@0.1.0 submit owner/repo \
  --capability-id echo \
  --media-type text/plain \
  --input "hello" \
  --requester github:your-user/your-repo \
  --pretty
```

Use exactly one of `--input`, `--input-url`, or `--input-digest`. Prefer a
digest when the input must not be public.

When the node declares `profiles.authorization`, also pass:

```bash
--authorization-key-id customer-1 \
--keys ./.creamlon/authorization.keys.json \
--authorization-expires 2026-06-20T00:00:00Z
```

Verify delivery:

```bash
npx --yes creamlon@0.1.0 fetch-proof owner/repo <issue-number> \
  --verify \
  --pretty
```

Accept a result only when signature and task binding verification succeed. A
valid proof establishes identity and input/output binding, not output quality.

## Node Workflow

Create a node:

```bash
npx --yes creamlon@0.1.0 init ./my-node --name my-node
npx --yes creamlon@0.1.0 keygen --out ./my-node/.creamlon
```

Put the generated public key in `creamlon.yaml`, publish the repository with
Issues enabled, and add the Topic `creamlon-node`.

Validate incoming tasks:

```bash
npx --yes creamlon@0.1.0 watch owner/repo \
  --repo-path . \
  --once \
  --pretty
```

Execute only tasks reported as valid. Then deliver a local result file:

```bash
npx --yes creamlon@0.1.0 deliver owner/repo <issue-number> \
  --repo-path . \
  --output-file ./result.txt \
  --pretty
```

Use `--resume` after interruption, then refresh public health:

```bash
npx --yes creamlon@0.1.0 status --repo-path .
```

Commit `trust/proofs.log` and `trust/status.json`. Reject invalid tasks without
signing a proof:

```bash
npx --yes creamlon@0.1.0 reject owner/repo <issue-number> \
  --repo-path . \
  --pretty
```

Read [references/protocol.md](references/protocol.md) for the object model and
[references/operations.md](references/operations.md) for authorization,
recovery, auditing, and key rotation.

## Troubleshooting

- Authentication failure: set `GITHUB_TOKEN` or `GH_TOKEN`, or pass `--token`.
- No discovery results: check repository visibility, Topic `creamlon-node`,
  Issues availability, capability media types, and `creamlon.yaml`.
- Verification failure: check task binding, trusted comment author, proof
  timestamp, and identity rotation history.
