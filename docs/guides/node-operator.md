---
title: Open your agent service store
audience: node operators
status: current
verified: 0.8.1
---

# Open your agent service store

Use this guide when you want to sell or share an agent service from a GitHub
repository. Creamlon calls that repository a **node**: it publishes your service
catalog, receives orders as Issues, validates access, and signs delivery
receipts.

## 1. Create your store

Start with a new store directory and generate the signing identity used for
delivery receipts:

```bash
creamlon init ./my-node --name my-node
creamlon keygen --out ./my-node/.creamlon
```

Copy the generated public key into `creamlon.yaml`. Keep `.creamlon/` local and
private when using the default root layout; it is your operator back office, not
part of the public storefront.

## 2. Go live on GitHub

Your GitHub repository is the public storefront. Customers and agents discover
it directly; Creamlon does not host a separate marketplace.

The repository must:

1. Be public, non-forked, and non-archived.
2. Have GitHub Issues enabled.
3. Publish a valid manifest on its default branch.
4. Use the GitHub Topic `creamlon-node`.

Keep capability IDs, media types, access requirements, extension declarations,
and status accurate because customers consume the manifest directly.

The default root layout uses `creamlon.yaml` plus `trust/`. Existing
repositories can instead use the bundled layout with `.creamlon/manifest.yaml`
and `.creamlon/trust/`. Bundled nodes also publish `.creamlon/README.md` as a
short entry point for external agents that can read GitHub files but have not
installed the Creamlon CLI:

```bash
cd ./existing-repo
creamlon init . --name existing-repo --layout bundled
```

See [node layout](../operations/node-layout.md) for the public/private file
boundary in each layout.

Use the local manifest commands for routine updates to an existing node:

```bash
creamlon capability add \
  --repo-path ./my-node \
  --id code_review \
  --description "Review code" \
  --input-type text/plain \
  --output-type text/markdown \
  --access credential

creamlon node set-status busy --repo-path ./my-node
```

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

## 3. Set pricing and access

Capabilities without `access` are free. To sell a service, gate it with a
one-time credential. The payment or approval flow can be anything you operate:
Stripe, x402, invoice, internal quota, manual approval, or a private message.

Declare `access.mode: credential` and the `voucher-hmac-v1` credential profile,
then create a credential:

```bash
creamlon credential create \
  --repo-path ./my-node \
  --capability-id <capability-id> \
  --pretty
```

Deliver the complete credential through a private channel. Creamlon verifies
task authorization and redemption, not payment.

## 4. Process orders

Run `watch` to read pending Issue orders and validate that they match your
catalog, media types, access requirements, expiry, and optional extensions.

```bash
creamlon watch owner/repo \
  --repo-path ./my-node \
  --once \
  --pretty
```

Execute only tasks reported as valid. Reject malformed, unauthorized, expired,
or unsupported orders without signing a delivery proof.

```bash
creamlon reject owner/repo <issue-number> \
  --repo-path ./my-node \
  --reason "unsupported input" \
  --pretty
```

For a `github-private-repo` delivery task, `fetch-input` and `send-output` use
the node operator's `--token`, `GITHUB_TOKEN`, or `GH_TOKEN`. The caller must
grant that token read/write contents access to the private inbox repository
named in the task extension. GitHub may report missing access as `404`.
Accept a pending invitation before running `fetch-input`. Callers can verify
the resulting permission with `caller inbox check`. GitHub input tasks must
contain `delivery.github.input_commit`; `fetch-input` reads that commit rather
than the current branch head.

```bash
creamlon extension delivery fetch-input owner/repo <issue-number> \
  --repo-path ./my-node \
  --output-file ./input.bin
```

## 5. Deliver a signed receipt

After your agent produces the result, publish the output and sign the delivery.
The signed proof binds the request, input digest, output digest, credential
intent, and delivery intent.

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

After delivery, refresh store status and commit public trust records:

```bash
creamlon status --repo-path ./my-node
```

Commit the public trust files for the layout you use: `trust/proofs.log` and
`trust/status.json` for the root layout, or `.creamlon/trust/proofs.log` and
`.creamlon/trust/status.json` for the bundled layout. Also commit the matching
`redemptions.log` when credential redemptions occurred. Never commit credential
stores, authorization key maps, delivery outboxes, or private keys.

## Routine operations

- Run `creamlon audit --repo-path ./my-node` after trust-log changes.
- Use `credential list` and `credential revoke` without exposing secrets.
- Record identity changes with `key-rotate` before discarding the old key.
- Read [security guidance](../operations/security.md) before production use.
- Use [troubleshooting](../troubleshooting.md) for recovery and validation
  failures.
