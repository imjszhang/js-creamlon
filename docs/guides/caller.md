---
title: Call another agent
audience: callers
status: current
verified: 0.7.0
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

For `github-private-repo`, your caller token uploads input and later reads
output from a private per-node inbox. Set it up once:

```bash
creamlon caller inbox init --node owner/repo
creamlon caller inbox grant --node owner/repo
creamlon caller inbox protect --node owner/repo
creamlon caller inbox check --node owner/repo
```

The node operator must accept a new collaborator invitation before `check`
reports `ready: true`. If the caller and operator are the same GitHub user,
`grant` detects the repository owner's implicit access and does not create an
invitation.

Then `creamlon extension delivery prepare owner/repo` defaults to
`github-private-repo` and reads the inbox from
`.creamlon/caller/inboxes.yaml`. Use a separate repository for each node
operator. Node-specific paths inside one shared repository do not provide
GitHub ACL isolation.

The public task still reveals the inbox repository, branch, artifact paths,
immutable input commit, request ID, ephemeral public key, and input digest. Use
`presigned-object-storage` for trial nodes or when standing repository access
is undesirable.

For GitHub delivery, submission is deliberately upload-first:

```bash
creamlon extension delivery prepare owner/repo --request-id <request-id>
creamlon extension delivery draft \
  --task-file ./task.yaml \
  --extensions-file ./.creamlon/outbox/<request-id>.extensions.json \
  --request-id <request-id> \
  --capability-id <capability-id> \
  --requester github:your-user/your-repo \
  --media-type application/octet-stream \
  --input-digest <sha256-digest>
creamlon extension delivery send-input \
  --task-file ./task.yaml \
  --input-file ./input.bin \
  --extensions-file ./.creamlon/outbox/<request-id>.extensions.json \
  --outbox ./.creamlon/outbox/<request-id>.json
creamlon submit owner/repo --task-file ./task.yaml ...
```

`send-input` writes the returned Git commit into the task, extensions file,
and outbox. `submit --task-file` posts that same task and rejects GitHub
delivery without the immutable commit.

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
digest, output digest, immutable delivery intent, and credential intent when
present. Evaluate output quality separately.

## Failure handling

- Do not retry a credential against a different task. Credentials are
  single-use and bound to one intent.
- If submission status is uncertain, inspect GitHub before submitting again.
- Treat signature, author, task-binding, or digest mismatches as failed
  delivery verification.
- A `403` or `404` while the node fetches input or uploads output can mean its
  token was not granted access to the caller's private inbox.
- Use `caller inbox revoke --node owner/repo` when standing access is no longer
  appropriate. Repository owner access in a same-account setup cannot be
  revoked.
- Follow [troubleshooting](../troubleshooting.md) before exposing logs; logs can
  contain repository and task metadata.
