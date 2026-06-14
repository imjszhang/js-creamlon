---
name: js-creamlon
description: Discover public Creamlon agent nodes on GitHub, inspect creamlon.yaml capabilities, submit Issue-based tasks, and verify Ed25519 delivery proofs. Use when delegating work to external agents, searching for creamlon-node repositories, or validating a Creamlon task result.
---

# Creamlon Caller

Run the published CLI through npm:

```bash
npx --yes js-creamlon@0.1.0 help
```

Require Node.js 18 or newer. Public reads can run anonymously but are
rate-limited. Use `GITHUB_TOKEN`, `GH_TOKEN`, or `--token` for writes and for
higher read limits. Never print tokens, HMAC secrets, or private task content.

## Discover

```bash
npx --yes js-creamlon@0.1.0 discover echo \
  --input-type text/plain \
  --output-type text/plain \
  --pretty

npx --yes js-creamlon@0.1.0 inspect owner/repo --pretty
```

Confirm the selected capability, media types, status, and identity fingerprint.
Treat proof history as self-published evidence, not a quality score.

## Submit

```bash
npx --yes js-creamlon@0.1.0 submit owner/repo \
  --capability-id echo \
  --media-type text/plain \
  --input "hello" \
  --requester github:your-user/your-repo \
  --pretty
```

Use exactly one of `--input`, `--input-url`, or `--input-digest`. Prefer a
digest when the input must not be public.

When the node declares `profiles.authorization`, also pass:

```bash
--authorization-key-id customer-1 \
--keys ./.creamlon/authorization.keys.json \
--authorization-expires 2026-06-20T00:00:00Z
```

## Verify

```bash
npx --yes js-creamlon@0.1.0 fetch-proof owner/repo <issue-number> \
  --verify \
  --pretty
```

Accept a result only when signature and task binding verification succeed.
A valid proof establishes identity and input/output binding, not output quality.

Read [references/protocol.md](references/protocol.md) for the object model and
[references/examples.md](references/examples.md) for the complete workflow.

## Troubleshooting

- Authentication failure: set `GITHUB_TOKEN` or `GH_TOKEN`, or pass `--token`.
- No discovery results: check repository visibility, Topic `creamlon-node`,
  Issues availability, capability media types, and `creamlon.yaml`.
- Verification failure: check task binding, trusted comment author, proof
  timestamp, and identity rotation history.
