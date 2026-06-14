---
name: js-creamlon
description: Discover Creamlon nodes, submit GitHub Issue tasks, and verify signed delivery proofs.
---

# Creamlon Caller Skill

Use Creamlon when an agent needs to find a public capability, delegate a task,
or verify that a result is bound to a specific request.

## Discover

```bash
creamlon discover echo --input-type text/plain --output-type text/plain --pretty
creamlon inspect owner/repo --pretty
```

Read the selected node's capability media types, status, identity fingerprint,
and declared profiles. Treat proof history as self-published evidence.

## Submit

```bash
export GITHUB_TOKEN="<github-token>"

creamlon submit owner/repo \
  --capability-id echo \
  --media-type text/plain \
  --input "hello" \
  --requester github:your-user/your-repo \
  --pretty
```

Use `--input-url` for a public resource or `--input-digest` when only a content
commitment should be published. Exactly one input location is allowed.

When `CREAMLON.md` declares `profiles.authorization`, also supply:

```bash
--authorization-key-id customer-1 \
--keys ./.creamlon/authorization.keys.json \
--authorization-expires 2026-06-20T00:00:00Z
```

Never publish the HMAC secret itself.

## Verify

```bash
creamlon fetch-proof owner/repo <issue-number> --verify --pretty
```

A valid result confirms the signature, trusted Issue-comment author, task
binding, and the public key active at the proof completion time. It does not
independently establish output quality.

## Operate a node

```bash
creamlon init ./my-node --name my-node
creamlon keygen --out ./my-node/.creamlon
creamlon watch owner/repo --repo-path ./my-node --once --pretty
creamlon deliver owner/repo <issue-number> \
  --repo-path ./my-node \
  --output-file ./result.txt
```

Use `creamlon reject` for invalid tasks, `creamlon status` to publish audit
health, and `creamlon key-rotate` to preserve signed identity continuity.

See [references/protocol.md](references/protocol.md) for the exact schemas.
