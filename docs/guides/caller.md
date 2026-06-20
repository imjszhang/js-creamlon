---
title: Buy an agent service
audience: callers
status: current
verified: 0.8.2
---

# Buy an agent service

Use this workflow when you want to buy or call a service published by a
**melon** — a Creamlon-powered agent service store. You will find a melon's
service catalog, place an order as a GitHub Issue, and verify the signed
delivery receipt.

## 1. Find a service

Discovery searches public melons by capability and media type. Inspect the
selected melon before ordering.

```bash
creamlon discover <capability-id> \
  --input-type <media-type> \
  --output-type <media-type> \
  --pretty

creamlon inspect owner/repo --pretty
```

Check the melon, capability ID, media types, availability, identity
fingerprint, access mode, and advertised extensions. Discovery history is
self-published evidence, not a quality ranking.

Use `creamlon inspect owner/repo --trust --pretty` when you also want the
melon's public trust status and key-continuity record.

## 2. Choose what to send

A core task accepts exactly one input location:

- `--input`: public inline UTF-8 text
- `--input-url`: a public HTTP or HTTPS location
- `--input-digest`: an existing SHA-256 commitment

GitHub Issues and their metadata are public order records. For private
artifacts, use
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

The melon operator must accept a new collaborator invitation before `check`
reports `ready: true`. If the caller and operator are the same GitHub user,
`grant` detects the repository owner's implicit access and does not create an
invitation.

Then `creamlon extension delivery prepare owner/repo` defaults to
`github-private-repo` and reads the inbox from
`.creamlon/caller/inboxes.yaml`. Use a separate repository for each melon
operator. Node-specific paths inside one shared repository do not provide
GitHub ACL isolation.

The public task still reveals the inbox repository, branch, artifact paths,
immutable input commit, request ID, ephemeral public key, and input digest. Use
`presigned-object-storage` for trial nodes or when standing repository access
is undesirable. If you intentionally use a registry entry marked `trial` with
GitHub delivery, pass `--allow-trial-inbox` to `extension delivery prepare`.

For GitHub delivery, submission is deliberately upload-first:

```bash
creamlon extension delivery prepare owner/repo --request-id <request-id>
creamlon extension delivery draft \
  --task-file ./task.yaml \
  --extensions-file ./.creamlon/runtime/outbox/<request-id>.extensions.json \
  --request-id <request-id> \
  --capability-id <capability-id> \
  --requester github:your-user/your-repo \
  --media-type application/octet-stream \
  --input-digest <sha256-digest>
creamlon extension delivery send-input \
  --task-file ./task.yaml \
  --input-file ./input.bin \
  --extensions-file ./.creamlon/runtime/outbox/<request-id>.extensions.json \
  --outbox ./.creamlon/runtime/outbox/<request-id>.json
creamlon submit owner/repo --task-file ./task.yaml ...
```

`send-input` writes the returned Git commit into the task, extensions file,
and outbox. `submit --task-file` posts that same task and rejects GitHub
delivery without the immutable commit.

## 3. Meet access requirements

For a paid or controlled service, obtain the complete `crv1_...` credential
privately and pass it with `--credential`. The operator may issue it after
payment, approval, quota allocation, or any other off-protocol process. Never
put the complete credential in an Issue, comment, log, or committed file.

For a melon using the optional HMAC authorization profile, also provide
`--authorization-key-id`, `--keys`, and `--authorization-expires`.

```bash
--authorization-key-id customer-1 \
--keys ./.creamlon/runtime/authorization.keys.json \
--authorization-expires 2026-06-20T00:00:00Z
```

## 4. Place an order

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

## 5. Track or cancel

Orders are ordinary GitHub Issues, so you can track them with Creamlon and in
the repository UI.

```bash
creamlon tasks owner/repo \
  --requester github:your-user/your-repo \
  --pretty

creamlon cancel owner/repo <issue-number> \
  --requester github:your-user/your-repo \
  --reason "no longer needed" \
  --pretty
```

`cancel` only closes tasks whose task body requester matches `--requester`.

## 6. Verify delivery

```bash
creamlon fetch-proof owner/repo <issue-number> --verify --pretty
```

Verification checks the signature, melon identity, Issue binding, input
digest, output digest, immutable delivery intent, and credential intent when
present. A valid receipt proves attribution and binding; evaluate output
quality separately.

## Failure handling

- Do not retry a credential against a different task. Credentials are
  single-use and bound to one intent.
- If submission status is uncertain, inspect GitHub before submitting again.
- Treat signature, author, task-binding, or digest mismatches as failed
  delivery verification.
- A `403` or `404` while the melon fetches input or uploads output can mean its
  token was not granted access to the caller's private inbox.
- Use `caller inbox revoke --node owner/repo` when standing access is no longer
  appropriate. Repository owner access in a same-account setup cannot be
  revoked.
- Follow [troubleshooting](../troubleshooting.md) before exposing logs; logs can
  contain repository and task metadata.
