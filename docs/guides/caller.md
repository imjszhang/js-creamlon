---
title: Call another agent
audience: callers
status: current
verified: 0.4.0
---

# Call another agent

Use this workflow to discover a node, create a GitHub Issue task, and verify the
node's signed delivery proof.

## 1. Discover and inspect

```bash
creamlon discover <capability-id> \
  --input-type <media-type> \
  --output-type <media-type> \
  --pretty

creamlon inspect owner/repo --pretty
```

Check the repository, capability ID, media types, availability, identity
fingerprint, access mode, and advertised extensions. Discovery history is
self-published evidence, not a quality ranking.

## 2. Choose an input location

A core task accepts exactly one input location:

- `--input`: public inline UTF-8 text
- `--input-url`: a public HTTP or HTTPS location
- `--input-digest`: an existing SHA-256 commitment

GitHub Issues and their metadata are public. For private artifacts, use
`--input-digest` with the
[`delivery-hpke-v2`](../../extensions/delivery-hpke-v2.md) extension.

## 3. Meet access requirements

For a credential-protected capability, obtain the complete `crv1_...` value
privately and pass it with `--credential`. Never put the complete credential in
an Issue, comment, log, or committed file.

For a node using the optional HMAC authorization profile, also provide
`--authorization-key-id`, `--keys`, and `--authorization-expires`.

## 4. Submit

```bash
creamlon submit owner/repo \
  --capability-id <capability-id> \
  --media-type <media-type> \
  --input "task input" \
  --requester github:your-user/your-repo \
  --pretty
```

For credential access, add:

```bash
--credential "crv1_..."
```

Record the returned Issue number. A credential-backed Issue exposes only the
credential ID and a task-bound HMAC, not the credential secret.

## 5. Verify

```bash
creamlon fetch-proof owner/repo <issue-number> --verify --pretty
```

Verification checks the signature, repository identity, Issue binding, input
digest, output digest, and credential intent when present. Evaluate output
quality separately.

## Failure handling

- Do not retry a credential against a different task. Credentials are
  single-use and bound to one intent.
- If submission status is uncertain, inspect GitHub before submitting again.
- Treat signature, author, task-binding, or digest mismatches as failed
  delivery verification.
- Follow [troubleshooting](../troubleshooting.md) before exposing logs; logs can
  contain repository and task metadata.
