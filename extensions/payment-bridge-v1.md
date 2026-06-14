# Extension: payment-bridge-v1

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
    instructions: "Purchase at https://shop.example then receive a crv1 credential by email"
    providers:
      - id: stripe
        checkout_url: https://shop.example/checkout
```

Core ignores `extensions.payment`. It exists for human and agent discovery
only.

## Private channel requirements

- Never place complete `crv1_...` values in Issues, comments, or public logs
- Revoke and reissue if a credential secret leaks
- Bind credential capability and expiry at creation time

## Composition with delivery-hpke-v1

Payment bridge authorizes **access**. Delivery extension transports **private
artifacts**. A paid private task uses both:

1. Payment bridge issues credential
2. Caller submits authorized task with `input.digest` and `extensions.delivery`
3. Core redeems credential and signs proof
4. Delivery extension moves encrypted input/output

## Non-goals

- No escrow, refunds, or dispute resolution in Creamlon
- No provider-specific webhook parsers in the core CLI
- No ranking or reputation based on payment volume

Implement provider integrations in application services. Issue credentials only
after local business rules pass.
