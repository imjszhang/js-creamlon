---
title: Creamlon Postcard demo
audience: callers and node operators
status: current
verified: 0.8.2
---

# Creamlon Postcard demo

Creamlon Postcard is the primary playable example for Creamlon. It shows a
complete agent-service flow: a buyer gets a one-time `postcard` credential,
submits a private prompt by digest, receives a private `postcard.png`, and
verifies the signed delivery proof.

The live example is published as
[`imjszhang/creamlon-postcard`](https://github.com/imjszhang/creamlon-postcard).
It is a bundled melon, so public protocol files live under `.creamlon/` while
private operator state stays in `.creamlon/runtime/`.

## What this example covers

Use Postcard when you want to see the main Creamlon pieces working together:

- public discovery through a GitHub repository with the `creamlon-node` topic
- a machine-readable `.creamlon/manifest.yaml` capability catalog
- credential-gated access with the `voucher-hmac-v1` profile
- a payment-bridge-style demo checkout that issues one-time access
- private buyer inbox delivery for credentials, prompts, and output artifacts
- public GitHub Issue tasks that expose only digests, credential IDs, and proof
  material
- signed receipt verification with `fetch-proof --verify`

The demo payment provider has price `0`; it keeps the checkout, receipt,
private inbox, and credential-redemption shape needed for a real paid vendor.

## Prerequisites

- Node.js 18 or newer
- A GitHub account and token for write operations
- A private GitHub repository dedicated to this demo inbox, for example
  `your-github-login/creamlon-inbox-postcard`
- The public Postcard repository:
  [`imjszhang/creamlon-postcard`](https://github.com/imjszhang/creamlon-postcard)

Public inspection can run without a token at lower GitHub rate limits. Set
`GITHUB_TOKEN`, `GH_TOKEN`, or pass `--token` for GitHub writes.

## 1. Inspect the melon

Start from the published node:

```bash
npx --yes creamlon@0.8.2 inspect imjszhang/creamlon-postcard --pretty
```

Confirm the manifest advertises:

- capability ID `postcard`
- `text/plain` input
- credential access mode
- credential profile `voucher-hmac-v1`
- payment provider `github-pages-demo-vendor`
- provider URL `https://imjszhang.github.io/creamlon-postcard/`

Agents can also inspect the example directly from GitHub by reading
`.creamlon/README.md` and `.creamlon/manifest.yaml` in the Postcard repository.

## 2. Prepare a private inbox

Create a dedicated private GitHub repository for this node, such as
`your-github-login/creamlon-inbox-postcard`. Grant the Postcard operator write
access. Do not use a repository that contains unrelated code or secrets.

Add this orientation file in the inbox:

```text
.creamlon-inbox/manifest.json
```

```json
{
  "version": "1",
  "type": "creamlon_private_inbox",
  "owner": "github:your-github-login",
  "seller": "github:imjszhang",
  "public_request_repo": "imjszhang/creamlon-postcard",
  "purpose": "credential-and-delivery-inbox"
}
```

The public Postcard repository is the request and trust surface. Complete
credentials, private prompts, and generated postcards flow only through the
buyer-owned private inbox.

## 3. Redeem a postcard ticket

Open the demo checkout advertised by the manifest:

```text
https://imjszhang.github.io/creamlon-postcard/
```

The buyer flow writes a demo receipt to the private inbox:

```text
.creamlon-inbox/purchases/pi_demo_YYYYMMDD_your-github-login.json
```

The receipt content must match the public redeem Issue:

```json
{
  "version": "1",
  "type": "purchase_receipt",
  "payment_intent_id": "pi_demo_YYYYMMDD_your-github-login",
  "provider": "github-pages-demo-vendor",
  "status": "paid",
  "buyer": "github:your-github-login",
  "capability_id": "postcard",
  "ref": "postcard-demo",
  "created_at": "<current ISO timestamp>"
}
```

Then open a public redeem Issue in `imjszhang/creamlon-postcard`:

```yaml
type: purchase-redeem
version: "1"
provider: github-pages-demo-vendor
payment_intent_id: pi_demo_YYYYMMDD_your-github-login
capability_id: postcard
buyer: github:your-github-login
inbox_repo: your-github-login/creamlon-inbox-postcard
receipt_path: .creamlon-inbox/purchases/pi_demo_YYYYMMDD_your-github-login.json
```

After the operator validates the receipt, the public Issue should receive a
comment with a `credential_id` and private inbox credential path. Read the
complete `crv1_...` credential only from the private inbox.

## 4. Submit a private postcard prompt

Use the helper from a local clone of the Postcard repository when running the
full demo locally:

```bash
git clone https://github.com/imjszhang/creamlon-postcard.git
cd creamlon-postcard
npm install

node scripts/submit-private-postcard.mjs \
  --inbox-repo your-github-login/creamlon-inbox-postcard \
  --requester github:your-github-login/creamlon-postcard-demo \
  --credential-file ./postcard_credential.json \
  --input "Create a warm birthday postcard for Alice with cats, cake, and stars."
```

The helper writes the prompt to the private inbox, submits a public GitHub Issue
with only `input.digest`, and adds the `extensions.postcard_private_input`
metadata the operator needs to fetch the private prompt.

## 5. Verify delivery

When the operator finishes, the private inbox receives `postcard.png` and
`delivery.json`. Anyone can verify the public proof:

```bash
npx --yes creamlon@0.8.2 fetch-proof imjszhang/creamlon-postcard <issue-number> \
  --verify \
  --pretty
```

A successful result reports `signature_ok` and `binding_ok`. The proof binds the
task, input digest, output digest, credential intent, and melon identity; it
does not make a quality claim about the postcard image.

## Operator view

Postcard is also the recommended implementation example for node operators. It
demonstrates a bundled repository layout, GitHub Pages checkout, credential
redemption, private input fetch, private output writeback, and public trust-log
updates.

The operator commands live in the
[`creamlon-postcard` README](https://github.com/imjszhang/creamlon-postcard#readme).
The buyer-agent playbook lives in the repository's
[`SKILL.md`](https://github.com/imjszhang/creamlon-postcard/blob/main/SKILL.md).

## Secret boundaries

Never publish or commit:

- complete `crv1_...` credentials
- GitHub tokens, private keys, `.env`, or `.creamlon/runtime/`
- private prompts, generated postcards, or private inbox contents
- payment signatures or real payment-provider secrets

Public Issues and trust records may contain `credential_id`, `input.digest`,
private inbox paths, immutable commits, and proof material.
