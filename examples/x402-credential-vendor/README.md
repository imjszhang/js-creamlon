# x402 credential vendor example

This example runs a small x402 resource server that sells Creamlon one-time
credentials. It is intentionally outside the core CLI and library: payment
provider integrations are application services, while Creamlon core still only
verifies `crv1_...` credentials and delivery proofs.

## Prerequisites

- Node.js 18 or newer
- A Creamlon node repository with keys and a credential store
- An x402 facilitator URL that supports your selected network and payment
  scheme
- A caller or wallet that can pay an x402 `402 Payment Required` response

## Configure

Run from this directory:

```bash
npm install
```

Set the server configuration:

```bash
export X402_FACILITATOR_URL="https://x402.facilitator.example"
export X402_PAY_TO="0x1111111111111111111111111111111111111111"
export X402_NETWORK="base"
export X402_ASSET="USDC"
export X402_PRICE="0.50"
export X402_AMOUNT="500000"
export CREAMLON_REPO_PATH="/absolute/path/to/node-repo"
export PUBLIC_BASE_URL="https://pay.example"
```

`X402_PRICE` is a display hint. `X402_AMOUNT` is the exact x402
facilitator-facing amount, usually in the asset's smallest unit. Confirm the
field names and units against the facilitator you use.

Optional variables:

- `PORT`: HTTP port, default `4020`
- `X402_ASSET_ADDRESS`: token contract or asset identifier when the facilitator
  expects an address instead of a symbol
- `X402_SCHEME`: payment scheme, default `exact`
- `X402_MAX_TIMEOUT_SECONDS`: payment timeout, default `300`
- `CREAMLON_BIN`: CLI executable, default `creamlon`
- `CREAMLON_CREDENTIAL_TTL_SECONDS`: issued credential lifetime, default `3600`
- `IDEMPOTENCY_STORE`: private local receipt store, default
  `.data/payments.json`
- `IDEMPOTENCY_LOCK_TIMEOUT_MS`: local receipt store lock timeout, default
  `10000`

## Run

```bash
npm start
```

The protected resource path is `/buy/<capability-id>`. For example:

```bash
curl -i http://localhost:4020/buy/code_review
```

The server responds with `402 Payment Required` and a `PAYMENT-REQUIRED` header
containing a base64url-encoded x402 `PaymentRequired` object. An x402 client
chooses one requirement, signs the payment, and retries:

```bash
curl -i \
  -H "PAYMENT-SIGNATURE: <base64-payment-payload>" \
  http://localhost:4020/buy/code_review
```

After the facilitator verifies and settles the payment, the server runs:

```bash
creamlon credential create \
  --repo-path "$CREAMLON_REPO_PATH" \
  --capability-id code_review \
  --expires "<iso timestamp>"
```

The `200 OK` response body contains the complete `crv1_...` value. Keep that
value private and submit it through the normal Creamlon flow:

```bash
creamlon submit owner/code-review-node \
  --capability-id code_review \
  --media-type text/plain \
  --input-file ./input.txt \
  --requester github:alice/caller \
  --credential "crv1_..." \
  --pretty
```

The node still delivers and signs results with the standard commands:

```bash
creamlon watch owner/code-review-node --repo-path "$CREAMLON_REPO_PATH" --once --pretty
creamlon deliver owner/code-review-node 42 --repo-path "$CREAMLON_REPO_PATH" --output-file ./output.md --pretty
creamlon fetch-proof owner/code-review-node 42 --verify --pretty
```

## Safety checks

- Verification failure must return `402` and must not call
  `creamlon credential create`.
- Settlement failure must return `402` and must not issue a credential.
- A retry with the same `PAYMENT-SIGNATURE` value is keyed by a private SHA-256
  digest and returns the same receipt instead of minting another credential.
- Do not log complete `crv1_...` values, `PAYMENT-SIGNATURE` headers,
  facilitator secrets, GitHub tokens, or private artifact URLs.
- Protect `IDEMPOTENCY_STORE` like a credential store. It may contain complete
  credentials so payment retries can be idempotent.

## Production notes

This example keeps the x402 integration intentionally small. A production
service should add TLS termination, structured private logs with redaction,
rate limits, persistent locking around the idempotency store, facilitator
allowlists, monitoring, and an operator process for revocation or reissue when
a credential leaks.
