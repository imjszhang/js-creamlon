# Extension: payment-bridge-v1

Namespace: `payment`
Status: experimental

Creamlon core verifies one-time task credentials (`voucher-hmac-v1`), not payment
or money movement. This extension documents the recommended pattern for
connecting external payment systems to credential issuance.

## Pattern

```text
Payment provider (Stripe, Lemon Squeezy, WeChat, invoice, manual)
        ↓ webhook or operator action
Node business rules satisfied
        ↓
creamlon credential create --capability-id <id>
        ↓
Deliver complete crv1_... through a private channel
        ↓
Caller: creamlon submit --credential ...
        ↓
Core redemption + Ed25519 proof
```

## Node manifest (optional hints)

```yaml
extensions:
  payment:
    pattern: payment-bridge-v1
    instructions: "Purchase at https://shop.example then receive a crv1 credential by email"
    providers:
      - id: stripe
        checkout_url: https://shop.example/checkout
      - id: x402
        resource_url: https://pay.example/buy/code_review
        network: base
        asset: USDC
        price: "0.50"
        pay_to: "0x1111111111111111111111111111111111111111"
        facilitator: https://x402.facilitator.example
```

Core ignores `extensions.payment`. It exists for human and agent discovery
only, and does not define machine-interpreted task fields.

## x402 provider

An `x402` provider turns the Creamlon credential into the protected HTTP
resource. The caller pays the resource server through the x402 `402 Payment
Required` flow, and the resource server issues a task credential only after
local payment verification and settlement succeed.

```text
Caller requests resource_url
        ↓
x402 resource server returns 402 payment requirements
        ↓
Caller retries with PAYMENT-SIGNATURE
        ↓
Resource server verifies and settles through a facilitator
        ↓
Resource server runs creamlon credential create --capability-id <id>
        ↓
Resource server returns complete crv1_... through the HTTP response body
```

Recommended manifest provider fields:

- `id`: always `x402`
- `resource_url`: HTTPS endpoint that sells one credential for the advertised
  capability
- `network`: x402 network identifier, for example `base`
- `asset`: settlement asset, for example `USDC`
- `price`: decimal display price for discovery; the resource server remains the
  authority for exact payment requirements
- `pay_to`: recipient address or account identifier used by the resource server
- `facilitator`: facilitator base URL used for x402 verification and settlement

The resource URL should encode or otherwise bind the purchased capability, and
the credential creation step must bind the same `capability_id` and expiry that
the payment was sold for. If the payment is for `code_review`, the issued
credential must not authorize a different capability.

x402 provider integrations must also be idempotent. A retry with the same
settled payment should return the same already-issued credential or a safe
non-secret receipt; it must not mint multiple credentials for one payment unless
the local business rule explicitly allows that.

## Private channel requirements

- Never place complete `crv1_...` values in Issues, comments, or public logs
- Revoke and reissue if a credential secret leaks
- Bind credential capability and expiry at creation time
- Treat `PAYMENT-SIGNATURE`, facilitator responses, and the complete credential
  as private operational data unless the payment scheme documents otherwise
- Public manifests may advertise price, asset, network, recipient, facilitator,
  and resource URL hints, but the x402 resource server remains authoritative

## Composition with delivery-hpke-v2

Payment bridge authorizes **access**. Delivery extension transports **private
artifacts**. A paid private task uses both:

1. Payment bridge issues a credential only after local payment verification and
   settlement succeed.
2. Caller uploads encrypted input through `delivery-hpke-v2` and submits an
   authorized task with `input.digest`, `extensions.delivery`, and the
   credential ID/HMAC binding.
3. Node validates the pending task, decrypts input, uploads encrypted output,
   and then calls core `deliver`.
4. Core atomically redeems the credential and signs the plaintext output digest.
5. Caller fetches encrypted output and verifies the delivery proof.

The two extensions do not trust each other for more than their own contract:
payment proves that a credential may be issued; delivery keeps artifacts out of
the public Issue; core credential redemption and Ed25519 proofs remain the
source of truth for task authorization and result verification.

## Non-goals

- No escrow, refunds, or dispute resolution in Creamlon
- No provider-specific webhook parsers in the core CLI
- No ranking or reputation based on payment volume

Implement provider integrations in application services. Issue credentials only
after local business rules pass.
