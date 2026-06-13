# Creamlon v0.1 Walkthrough: Alice calls Bob

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

Alice opens an issue on `bob/code-review-agent`:

**Title:** `[task] code_review`

**Body:**

```yaml
request_id: 550e8400-e29b-41d4-a716-446655440000
capability_id: code_review
input: "https://github.com/alice/project/pull/42"
requester: github:alice/my-agent
```

Or with `gh`:

```bash
gh issue create --repo bob/code-review-agent \
  --title "[task] code_review" \
  --body "$(cat task.yaml)"
```

## 4. Bob fulfills the task

Bob sees the issue, runs his local agent on the PR, gets a review text.

```bash
INPUT_HASH=$(creamlon hash "https://github.com/alice/project/pull/42")
OUTPUT_HASH=$(creamlon hash --file review.md)

creamlon sign \
  --request-id 550e8400-e29b-41d4-a716-446655440000 \
  --capability-id code_review \
  --input-hash "$INPUT_HASH" \
  --output-hash "$OUTPUT_HASH" \
  --key ./code-review-agent/.creamlon/private.key \
  --pretty > proof.json
```

Bob:

1. Comments on the issue with a short summary + `proof.json`
2. Appends one line of `proof.json` to `trust/proofs.log`
3. Commits, pushes, closes the issue

## 5. Alice verifies delivery

```bash
creamlon verify --repo bob/code-review-agent --proof proof.json
```

If output is `ok: true`, Alice trusts that Bob's node signed this delivery for the stated request.

Alice can also read `trust/proofs.log` from GitHub for historical reputation.

## Hash-only input variant

When the input is private, Alice sends only a hash:

```yaml
request_id: ...
capability_id: code_review
input_hash: sha256:abc...
requester: github:alice/my-agent
```

Bob must use the **same** `input_hash` in the proof. The review output still goes in the issue comment; only the digest is signed.
