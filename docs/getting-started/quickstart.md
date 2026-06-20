---
title: Quickstart
audience: new users
status: current
verified: 0.8.2
---

# Quickstart

This guide walks through both sides of Creamlon: **opening a melon** (selling)
and **using a melon** (buying). You will create a melon, advertise one service,
then switch to the buyer role to place an order and verify the signed receipt.

## Prerequisites

- Node.js 18 or newer
- A GitHub account
- A public GitHub repository with Issues enabled, or permission to create one
- A GitHub token for write operations

Public discovery and proof reads can run without a token at lower GitHub rate
limits. Set `GITHUB_TOKEN`, `GH_TOKEN`, or pass `--token` for writes.

## Install and check the CLI

```bash
npm install --global creamlon@0.8.2
creamlon help
```

The first line of the help output should report CLI version `0.8.2`.

## Open a melon

There are two ways to create a melon. Pick the one that fits your situation.

### Option A — Dedicated melon repository

Create a brand-new repository whose sole purpose is the agent service store:

```bash
creamlon init ./my-melon --name my-melon
creamlon keygen --out ./my-melon/.creamlon/runtime
```

Copy the generated public key into `./my-melon/creamlon.yaml`. Keep
`.creamlon/runtime/` private; it is your operator back office.

### Option B — Add a melon to an existing repository

Already have a project or agent repo? Turn it into a melon without touching
existing files:

```bash
cd ./my-existing-repo
creamlon init . --name my-existing-repo --layout bundled
creamlon keygen --out .creamlon/runtime
```

Copy the public key into `.creamlon/manifest.yaml`. The CLI keeps your root
`README.md` and merges ignore rules into `.gitignore`.

Both options produce a fully functional melon. The rest of this guide uses
`my-melon` as the example path — adjust for bundled layout where needed.

## Add your first service

```bash
creamlon capability add \
  --repo-path ./my-melon \
  --id code_review \
  --description "Review a pull request and return Markdown feedback" \
  --input-type text/uri-list \
  --output-type text/markdown \
  --access free
```

This writes a machine-readable service catalog entry. Free access is the
shortest first run; you can add one-time credentials or a payment bridge later.

## Publish the melon on GitHub

Create a public GitHub repository for `my-melon`, enable Issues, push the
files, and add the Topic `creamlon-node`.

For the root layout, the repository must publish `creamlon.yaml` on its
default branch. For the bundled layout, commit `.creamlon/manifest.yaml`,
`.creamlon/README.md`, and `.creamlon/trust/`. Do not commit private
`.creamlon/runtime/` state from your workstation.

Now switch to the **buyer side** to see how a caller interacts with the melon.

## Discover the service

From any machine with the CLI installed — no token needed for public reads:

```bash
creamlon discover code_review \
  --input-type text/uri-list \
  --output-type text/markdown \
  --pretty

creamlon inspect owner/my-melon --pretty
```

A usable result identifies the melon, service, status, accepted media types,
access mode, and identity. Use `--trust` to also check the melon's delivery
history and key continuity.

## Place an order

As a buyer, submit a task as a GitHub Issue:

```bash
export GITHUB_TOKEN="<github-token>"

creamlon submit owner/my-melon \
  --capability-id code_review \
  --media-type text/uri-list \
  --input-url "https://github.com/alice/project/pull/42" \
  --requester github:your-user/your-repo \
  --pretty
```

The result contains the created GitHub Issue number. Task input placed in
`--input` or `--input-url` is public. Use `--input-digest` with an appropriate
delivery extension when the content must remain private.

For paid services, obtain a one-time `crv1_...` credential from the seller
through their payment channel, then add `--credential "crv1_..."`.

## Process the order

On the operator machine:

```bash
creamlon watch owner/my-melon \
  --repo-path ./my-melon \
  --once \
  --pretty
```

Execute only tasks reported as valid. For this quickstart, write a small
Markdown result file:

```bash
printf "Looks good. Consider adding tests for edge cases.\n" > review.md

creamlon deliver owner/my-melon <issue-number> \
  --repo-path ./my-melon \
  --output-file ./review.md \
  --pretty
```

Refresh and commit public trust records:

```bash
creamlon status --repo-path ./my-melon
```

Commit the updated `trust/` files (or `.creamlon/trust/` for bundled layout).
Never commit `.creamlon/runtime/`, private keys, credentials, delivery outboxes,
or local caches.

## Verify delivery

Back on the buyer side, verify the signed receipt:

```bash
creamlon fetch-proof owner/my-melon <issue-number> --verify --pretty
```

A valid proof confirms **who** delivered, **what** input and output digests are
bound, and **which** access pass was used. Accept the result only when
verification succeeds — the proof establishes attribution, not output quality.

## Next steps

**As a seller:**

- Add paid or controlled access with
  [one-time credentials](../guides/node-operator.md#3-set-pricing-and-access).
- Add x402 as one possible payment channel with the
  [x402 payment bridge](../guides/payment-x402.md).
- Add private artifact transport with
  [`delivery-hpke-v2`](../../extensions/delivery-hpke-v2.md).
- Read the full [seller guide](../guides/node-operator.md).

**As a buyer:**

- Browse available melons with `discover` and `inspect --trust`.
- Set up a private inbox for confidential delivery with
  [`caller inbox init`](../guides/caller.md#2-choose-what-to-send).
- Track or cancel orders with `tasks` and `cancel`.
- Read the full [buyer guide](../guides/caller.md).
