---
title: Security
audience: all users
status: current
verified: 0.8.1
---

# Security

Creamlon melons use public GitHub repositories and Issues as storefronts,
order records, and delivery receipt transports. Treat repository names, Issue
metadata, timestamps, actors, capability IDs, URLs, inline inputs, and comments
as public information.

## Layout boundary

Root-layout melons keep public protocol files in `creamlon.yaml` and `trust/`,
and private local state in `.creamlon/runtime/` under the ignored `.creamlon/`
directory.

Bundled-layout melons keep public protocol files in `.creamlon/manifest.yaml`
and `.creamlon/trust/`. In that layout, do not ignore or publish the whole
`.creamlon/` directory blindly; commit only the public manifest and trust
records, and ignore `.creamlon/runtime/`.

## Never publish

- Ed25519 private keys
- complete `crv1_...` credentials
- `.creamlon/runtime/private.key`
- `.creamlon/runtime/credentials.json`
- `.creamlon/runtime/authorization.keys.json`
- HMAC authorization key maps
- GitHub tokens
- private delivery outbox files, GET URLs, or plaintext artifacts

Use exact secrets only through private channels and local files with restricted
permissions. Prefer digest-based task inputs and encrypted delivery when task
content must not be public.

Encrypted delivery does not hide all metadata. A public task using
`github-private-repo` exposes the private inbox repository slug, branch,
artifact paths, request ID, ephemeral public key, and input digest. Use opaque
paths and choose `presigned-object-storage` when this correlation or standing
cross-account repository access is unacceptable.

GitHub delivery pins each input to the commit returned by upload. Protect the
inbox branch against force-push and deletion, but do not treat Git history as
task isolation: a collaborator can still disrupt other paths at the branch
head. Digest and signed delivery-intent verification prevent modified content
from being accepted as the original task.

## Verify before accepting

Customers should use `fetch-proof --verify` and reject signature, author,
identity, task-binding, or digest mismatches. A valid proof is a signed
delivery receipt, not a quality or confidentiality guarantee.

Creamlon treats proof comments from repository owners, members,
collaborators, and GitHub Apps as trusted proof carriers. Only grant Issue
comment permissions to Apps that are allowed to publish delivery proofs for the
melon, and review installed Apps before relying on automated delivery.

Melon operators should validate tasks with `watch` before execution and use
`audit` after proof, redemption, or key-rotation log changes.

## Credential exposure

If a complete credential appears in an Issue, comment, log, or commit:

1. Treat it as compromised.
2. Revoke it before use.
3. Issue a replacement through a private channel.
4. Remove exposed copies where possible, while assuming Git history and logs
   may retain them.

## Key or token exposure

Revoke exposed GitHub tokens immediately. For an exposed melon private key,
stop delivery, preserve audit evidence, rotate identity with the previous key
when it is still trustworthy, and notify callers that pin the old identity.

Report suspected signature bypasses or secret-handling vulnerabilities through
the private process in the repository [security policy](../../SECURITY.md), not
a public Issue.
