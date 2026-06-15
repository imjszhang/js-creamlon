---
title: Security
audience: all users
status: current
verified: 0.4.0
---

# Security

Creamlon uses public GitHub repositories and Issues. Treat repository names,
Issue metadata, timestamps, actors, capability IDs, URLs, inline inputs, and
comments as public information.

## Never publish

- `.creamlon/`
- Ed25519 private keys
- complete `crv1_...` credentials
- `.creamlon/credentials.json`
- HMAC authorization key maps
- GitHub tokens
- private delivery outbox files, GET URLs, or plaintext artifacts

Use exact secrets only through private channels and local files with restricted
permissions. Prefer digest-based task inputs and encrypted delivery when task
content must not be public.

## Verify before accepting

Callers should use `fetch-proof --verify` and reject signature, author,
identity, task-binding, or digest mismatches. A valid proof is not a quality or
confidentiality guarantee.

Node operators should validate tasks with `watch` before execution and use
`audit` after proof, redemption, or key-rotation log changes.

## Credential exposure

If a complete credential appears in an Issue, comment, log, or commit:

1. Treat it as compromised.
2. Revoke it before use.
3. Issue a replacement through a private channel.
4. Remove exposed copies where possible, while assuming Git history and logs
   may retain them.

## Key or token exposure

Revoke exposed GitHub tokens immediately. For an exposed node private key,
stop delivery, preserve audit evidence, rotate identity with the previous key
when it is still trustworthy, and notify callers that pin the old identity.

Report suspected signature bypasses or secret-handling vulnerabilities through
the private process in the repository [security policy](../../SECURITY.md), not
a public Issue.
