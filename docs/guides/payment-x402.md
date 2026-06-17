---
title: x402 payment bridge
audience: node operators
status: experimental
verified: 0.7.0
---

# x402 payment bridge

Use x402 when a caller agent should pay for a Creamlon capability without a
checkout account, invoice, or manual approval. Creamlon still verifies the
one-time credential and delivery proof; x402 only decides when an application
service may issue that credential.

This guide uses the [payment bridge pattern](../../extensions/payment-bridge-v1.md).
The sample resource server lives in
[`examples/x402-credential-vendor`](https://github.com/imjszhang/js-creamlon/tree/main/examples/x402-credential-vendor);
examples are kept outside the npm package.

## Prerequisites

- A Creamlon node repository with a credential-protected capability
- A private `.creamlon/credentials.json` store owned by the node operator
- An x402 facilitator that supports your selected network, asset, and payment
  scheme
- An HTTPS endpoint where caller agents can reach the x402 resource server

## Advertise the provider

Add payment discovery hints to `creamlon.yaml`. Core ignores this section; it
is for humans and agents choosing how to obtain a credential.

```yaml
extensions:
  payment:
    pattern: payment-bridge-v1
    instructions: "Pay with x402 to receive a one-time Creamlon credential."
    providers:
      - id: x402
        resource_url: https://pay.example/buy/code_review
        network: base
        asset: USDC
        price: "0.50"
        pay_to: "0x1111111111111111111111111111111111111111"
        facilitator: https://x402.facilitator.example
```

The `resource_url` should sell exactly one credential for the named capability.
The server remains authoritative for exact x402 payment requirements, amounts,
timeouts, and facilitator behavior.

## Run a credential vendor

The example service is a small x402 resource server. It returns `402 Payment
Required` for `/buy/<capability-id>`, verifies and settles the caller's
`PAYMENT-SIGNATURE` header through a facilitator, then runs
`creamlon credential create` against the node repository.

```bash
cd examples/x402-credential-vendor
npm install

export X402_FACILITATOR_URL="https://x402.facilitator.example"
export X402_PAY_TO="0x1111111111111111111111111111111111111111"
export X402_NETWORK="base"
export X402_ASSET="USDC"
export X402_PRICE="0.50"
export X402_AMOUNT="500000"
export CREAMLON_REPO_PATH="/absolute/path/to/node-repo"
export PUBLIC_BASE_URL="https://pay.example"

npm start
```

The observable success result is a private HTTP `200 OK` response containing a
complete `crv1_...` credential after the facilitator accepts settlement.

## Caller flow

A caller agent reads the manifest, requests the advertised `resource_url`, and
receives x402 payment requirements:

```bash
curl -i https://pay.example/buy/code_review
```

After signing the payment with an x402 client or wallet, the caller retries
with `PAYMENT-SIGNATURE`:

```bash
curl -i \
  -H "PAYMENT-SIGNATURE: <base64-payment-payload>" \
  https://pay.example/buy/code_review
```

The response body contains the complete credential. Use it with the standard
submit command:

```bash
creamlon submit owner/code-review-node \
  --capability-id code_review \
  --media-type text/plain \
  --input-file ./input.txt \
  --requester github:alice/caller \
  --credential "crv1_..." \
  --pretty
```

The node processes the task normally. Delivery proofs and optional private
delivery extensions do not change.

## Private delivery composition

x402 payment and private delivery are independent layers. x402 decides when the
vendor may issue a one-time credential; `delivery-hpke-v2` moves private input
and output artifacts. A paid private task uses both:

1. Caller pays the x402 `resource_url` and receives a private `crv1_...`
   credential.
2. Caller prepares private delivery, uploads encrypted input, and submits the
   resulting task file with that credential.
3. Node verifies the credential during `watch`, decrypts input with
   `fetch-input`, uploads encrypted output with `send-output`, and then runs
   `deliver`.
4. Caller runs `fetch-output` and `fetch-proof --verify`.

```bash
creamlon caller inbox init --node owner/private-node
creamlon caller inbox grant --node owner/private-node
creamlon caller inbox check --node owner/private-node

creamlon extension delivery prepare owner/private-node \
  --outbox-dir ./.creamlon/outbox \
  --pretty

creamlon extension delivery draft \
  --task-file ./task.yaml \
  --extensions-file ./.creamlon/outbox/<request-id>.extensions.json \
  --request-id <request-id> \
  --capability-id code_review \
  --requester github:alice/private-inbox \
  --media-type text/plain \
  --input-digest <sha256-digest>

creamlon extension delivery send-input \
  --task-file ./task.yaml \
  --input-file ./input.txt \
  --extensions-file ./.creamlon/outbox/<request-id>.extensions.json \
  --outbox ./.creamlon/outbox/<request-id>.json \
  --receive-public-key <node-delivery-public-key>

creamlon submit owner/private-node \
  --task-file ./task.yaml \
  --credential "crv1_..." \
  --pretty
```

The public Issue still exposes delivery metadata such as the inbox repository,
artifact paths, immutable input commit, request ID, ephemeral public key, and
input digest. It must not contain the complete credential, payment signature,
plaintext input, or plaintext output.

## Secret boundaries

These values must stay out of public Issues, comments, commits, and logs:

- complete `crv1_...` credentials
- `PAYMENT-SIGNATURE` headers and raw facilitator payloads
- GitHub tokens, facilitator credentials, and private keys
- private artifact URLs or plaintext private task data

These values are safe as public discovery hints when they do not disclose
private business terms: `resource_url`, `network`, `asset`, display `price`,
`pay_to`, and `facilitator`.

## Operator checks

- Bind the sold resource path to the same `capability_id` passed to
  `creamlon credential create`.
- Do not issue a credential when facilitator verification or settlement fails.
- Set a credential expiry that matches the paid offer.
- Make retries idempotent so one settled x402 payment cannot mint multiple
  credentials by accident.
- Revoke and reissue a credential if the complete `crv1_...` value leaks.
- Verify the final delivery with `creamlon fetch-proof --verify`; x402 confirms
  payment, not output quality.
