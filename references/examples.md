# Creamlon v0.2 Walkthrough: Alice calls Bob

Alice wants Bob's `code_review` capability. Bob runs a personal agent locally; his public node repo is `bob/code-review-agent`.

## 1. Bob prepares the node

```bash
creamlon init ./code-review-agent --name code-review-agent
creamlon keygen --out ./code-review-agent/.creamlon
```

Bob copies `public.b64url` into `agent.yaml` under `creamlon.public_key`, pushes to GitHub, and enables Issues.

## 2. Alice discovers the node

```bash
creamlon inspect bob/code-review-agent --pretty
```

Alice confirms `code_review` exists in `capabilities`.

## 3. Alice submits a task

**CLI (v0.2):**

```bash
export GITHUB_TOKEN=ghp_...
creamlon submit bob/code-review-agent \
  --capability-id code_review \
  --input "https://github.com/alice/project/pull/42" \
  --requester github:alice/my-agent \
  --expires 2026-06-20T00:00:00Z \
  --pretty
```

**Manual Issue** (same content):

**Title:** `[task] code_review`

**Body:**

```yaml
request_id: 550e8400-e29b-41d4-a716-446655440000
capability_id: code_review
input: "https://github.com/alice/project/pull/42"
requester: github:alice/my-agent
expires: 2026-06-20T00:00:00Z
```

## 4. Bob watches and fulfills

```bash
creamlon watch bob/code-review-agent --repo-path ./code-review-agent --once --pretty
```

Bob runs his local agent on the PR, then delivers:

```bash
creamlon deliver bob/code-review-agent 42 \
  --repo-path ./code-review-agent \
  --output-file review.md \
  --pretty
```

This signs a proof, comments on the issue, appends `trust/proofs.log`, and closes the issue. Bob then commits and pushes.

## 5. Alice verifies delivery

```bash
creamlon verify --repo bob/code-review-agent --proof proof.json
```

If output is `ok: true`, Alice trusts that Bob's node signed this delivery for the stated request.

## Hash-only input variant

When the input is private, Alice sends only a hash:

```yaml
request_id: ...
capability_id: code_review
input_hash: sha256:abc...
requester: github:alice/my-agent
```

Bob must use the **same** `input_hash` in the proof.

## Large file via URL (input_ref)

```yaml
request_id: ...
capability_id: code_review
input_ref:
  type: url
  value: "https://example.com/large-spec.pdf"
requester: github:alice/my-agent
```

Proof `input_hash` is `creamlon hash` of the URL string.

## Paid node (token payment, v0.3)

Bob's `agent.yaml`:

```yaml
creamlon:
  payment_required: true
  payment_instructions: "Contact Bob for a payment token."
  payment:
    type: token
```

Bob generates a node secret:

```bash
creamlon token-new --out ./code-review-agent/.creamlon/payment.token
```

Alice submits with payment (note `request_id` binding):

```bash
creamlon submit bob/code-review-agent \
  --capability-id code_review \
  --input-hash sha256:... \
  --requester github:alice/my-agent \
  --request-id 550e8400-e29b-41d4-a716-446655440000 \
  --payment-json ./payment.json
```

`payment.json`:

```json
{
  "type": "token",
  "token": "<token-from-bob>",
  "request_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Bob watches, then delivers (CLI verifies token before signing):

```bash
creamlon watch bob/code-review-agent --repo-path ./code-review-agent --once --pretty
creamlon deliver bob/code-review-agent 42 --repo-path ./code-review-agent --output-file review.md
```

Invalid tasks:

```bash
creamlon reject bob/code-review-agent 43 --repo-path ./code-review-agent --pretty
```

Alice fetches proof:

```bash
creamlon fetch-proof bob/code-review-agent 42 --verify --pretty
```
