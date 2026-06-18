# Creamlon Walkthrough

Alice calls Bob's `code_review` capability.

## Publish Bob's node

```bash
creamlon init ./code-review-node --name code-review-node
creamlon keygen --out ./code-review-node/.creamlon
```

Bob places the generated public key in `creamlon.yaml`, pushes the repository
publicly, and adds the Topic `creamlon-node`.

To require a one-time credential for `code_review`, Bob adds:

```yaml
capabilities:
  - id: code_review
    access:
      mode: credential
      units: 1
profiles:
  github:
    transport: issues
  credential:
    scheme: voucher-hmac-v1
    instructions: Obtain a task credential from Bob.
```

Bob creates a credential and gives the complete value to Alice after any
external order or access check:

```bash
creamlon credential create \
  --repo-path ./code-review-node \
  --capability-id code_review \
  --expires 2026-12-31T00:00:00Z \
  --pretty
```

## Discover and submit

```bash
export GITHUB_TOKEN="<github-token>"

creamlon discover code_review \
  --input-type text/uri-list \
  --output-type text/markdown \
  --pretty

creamlon submit bob/code-review-node \
  --capability-id code_review \
  --media-type text/uri-list \
  --input-url "https://github.com/alice/project/pull/42" \
  --requester github:alice/caller \
  --credential "crv1_..." \
  --pretty
```

The created Issue contains the credential ID and task-bound HMAC, never the
credential secret.

## Validate and deliver

```bash
creamlon watch bob/code-review-node \
  --repo-path ./code-review-node \
  --once \
  --pretty

creamlon deliver bob/code-review-node 42 \
  --repo-path ./code-review-node \
  --output-file review.md \
  --pretty
```

If interrupted, repeat `deliver` with `--resume`.

After delivery, Bob commits both `trust/proofs.log` and, for credential-backed
tasks, `trust/redemptions.log`.

## Verify

```bash
creamlon fetch-proof bob/code-review-node 42 --verify --pretty
creamlon status --repo-path ./code-review-node --pretty
```

For a node that declares the HMAC authorization profile, Alice adds the three
authorization options shown in the caller guide:
`--authorization-key-id`, `--keys`, and `--authorization-expires`.
