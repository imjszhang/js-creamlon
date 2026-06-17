---
name: creamlon-skill
description: "Use the Creamlon protocol as either a caller or node operator: discover public agent capabilities on GitHub, redeem one-time task credentials, submit Issue-based tasks, verify Ed25519 delivery proofs, create and operate nodes, issue credentials, validate incoming tasks, publish results, audit proof logs, and rotate identity keys."
---

# Creamlon

Run the published CLI through npm:

```bash
npx --yes creamlon@0.7.0 help
```

Require Node.js 18 or newer. Public reads can run anonymously but are
rate-limited. Use `GITHUB_TOKEN`, `GH_TOKEN`, or `--token` for writes and higher
read limits. Never print tokens, credential secrets, HMAC secrets, private
keys, or private task content.

Choose the caller workflow when delegating work. Choose the node workflow when
creating or operating a repository that publishes `creamlon.yaml`.

## Caller Workflow

Discover and inspect:

```bash
npx --yes creamlon@0.7.0 discover echo \
  --input-type text/plain \
  --output-type text/plain \
  --pretty

npx --yes creamlon@0.7.0 inspect owner/repo --pretty
```

Confirm the capability, media types, status, and identity fingerprint. Treat
proof history as self-published evidence, not a quality score.

Submit a task:

```bash
npx --yes creamlon@0.7.0 submit owner/repo \
  --capability-id echo \
  --media-type text/plain \
  --input "hello" \
  --requester github:your-user/your-repo \
  --pretty
```

Use exactly one of `--input`, `--input-url`, or `--input-digest`. Prefer a
digest when the input must not be public.

When the capability declares `access.mode: credential`, obtain the complete
`crv1_...` value privately and add:

```bash
--credential "crv1_..."
```

Never put that value in an Issue, comment, log, or committed file. `submit`
publishes only the credential ID and task-bound HMAC.

When the node declares `profiles.authorization`, also pass:

```bash
--authorization-key-id customer-1 \
--keys ./.creamlon/authorization.keys.json \
--authorization-expires 2026-06-20T00:00:00Z
```

Verify delivery:

```bash
npx --yes creamlon@0.7.0 fetch-proof owner/repo <issue-number> \
  --verify \
  --pretty
```

Accept a result only when signature and task binding verification succeed. A
valid proof establishes identity and input/output binding, not output quality.

## Private artifact delivery (extension)

For encrypted input/output transport, use the RFC 9180 `delivery-hpke-v2`
extension.
Core Issues carry digests and proofs only. See `extensions/delivery-hpke-v2.md`
in the repository.

Caller agent sequence:

```bash
npx --yes creamlon@0.7.0 caller inbox init --node owner/repo
npx --yes creamlon@0.7.0 caller inbox grant --node owner/repo
npx --yes creamlon@0.7.0 caller inbox protect --node owner/repo

npx --yes creamlon@0.7.0 extension delivery prepare owner/repo \
  --request-id <request_id>

npx --yes creamlon@0.7.0 extension delivery draft \
  --task-file ./task.yaml \
  --extensions-file ./.creamlon/outbox/<request_id>.extensions.json \
  --request-id <request_id> --capability-id code_review \
  --requester github:your-user/your-repo \
  --media-type application/octet-stream --input-digest sha256:...

npx --yes creamlon@0.7.0 extension delivery send-input \
  --task-file ./task.yaml --input-file ./input.bin \
  --extensions-file ./.creamlon/outbox/<request_id>.extensions.json \
  --outbox ./.creamlon/outbox/<request_id>.json \
  --receive-public-key <node-delivery-public-key>

npx --yes creamlon@0.7.0 submit owner/repo --task-file ./task.yaml

npx --yes creamlon@0.7.0 fetch-proof owner/repo <issue-number> --verify --pretty

npx --yes creamlon@0.7.0 extension delivery fetch-output owner/repo <issue-number> \
  --outbox .creamlon/outbox/<request_id>.json \
  --output-file ./result.md
```

For GitHub delivery, never submit before `send-input` has written
`delivery.github.input_commit` into the task, extensions file, and outbox.
Never put GET URLs, delivery private keys, or artifact plaintext in Issues.

## Node Workflow

Create a node:

```bash
npx --yes creamlon@0.7.0 init ./my-node --name my-node
npx --yes creamlon@0.7.0 keygen --out ./my-node/.creamlon
```

Put the generated public key in `creamlon.yaml`, publish the repository with
Issues enabled, and add the Topic `creamlon-node`.

For a credential-protected capability, declare `access.mode: credential` and
`profiles.credential.scheme: voucher-hmac-v1`, then create a one-time
credential:

```bash
npx --yes creamlon@0.7.0 credential create \
  --repo-path . \
  --capability-id code_review \
  --pretty
```

Deliver the complete credential privately through the supplier's chosen order
or access channel. Creamlon verifies redemption, not money movement.

Validate incoming tasks:

```bash
npx --yes creamlon@0.7.0 watch owner/repo \
  --repo-path . \
  --once \
  --pretty
```

Execute only tasks reported as valid. For private delivery, upload the output
before publishing the proof:

```bash
npx --yes creamlon@0.7.0 extension delivery send-output owner/repo <issue-number> \
  --repo-path . \
  --output-file ./result.txt

npx --yes creamlon@0.7.0 deliver owner/repo <issue-number> \
  --repo-path . \
  --output-file ./result.txt \
  --pretty
```

For private delivery tasks, decrypt input before execution:

```bash
npx --yes creamlon@0.7.0 extension delivery keygen --out .creamlon

npx --yes creamlon@0.7.0 extension delivery fetch-input owner/repo <issue-number> \
  --repo-path . --output-file ./input.bin --input-get-url <private-url-if-presigned>

```

Use `--resume` after interruption, then refresh public health:

```bash
npx --yes creamlon@0.7.0 status --repo-path .
```

Commit `trust/proofs.log`, `trust/redemptions.log` when present, and
`trust/status.json`. Reject invalid tasks without signing a proof:

```bash
npx --yes creamlon@0.7.0 reject owner/repo <issue-number> \
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
