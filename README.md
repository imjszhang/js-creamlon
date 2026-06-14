# js-creamlon

**Creamlon** — verifiable cross-agent task delegation via public GitHub repositories.

Personal agents (Claude Code, OpenClaw, Codex, etc.) stay on your device. A public **node repo** advertises capabilities; callers submit tasks via **GitHub Issues**; delivery is backed by **Ed25519 proofs** in `trust/proofs.log`.

## Two-layer model

| Layer | What |
|-------|------|
| **Protocol** | `agent.yaml` + Issues + signed proof |
| **Skill + CLI** | Teach agents how to use it; `creamlon` commands for humans and scripts |

## Install CLI

```bash
cd js-creamlon
npm link
creamlon help
```

Requires Node.js 18+. For GitHub commands, set `GITHUB_TOKEN`.

## Quick start: create a node

```bash
creamlon init ./my-agent-node --name my-agent
creamlon keygen --out ./my-agent-node/.creamlon
creamlon payment-key-new \
  --key-id customer-1 \
  --out ./my-agent-node/.creamlon/payment.keys.json
```

1. Copy `public.b64url` into `agent.yaml` → `creamlon.public_key`
2. Push to a public GitHub repo and add the Topic `creamlon-node`
3. Install `template/agent-node/SKILL.md` for local fulfillment guidance

Every task requires a short-lived HMAC credential.

## Discover nodes

```bash
export GITHUB_TOKEN="<github-token>"
creamlon discover echo \
  --input-type text/plain \
  --output-type text/plain \
  --pretty
```

Discovery uses GitHub Topic search and validates each repository's current
`agent.yaml`. Results include public-key fingerprints, signed proof history,
key continuity, and recent health status. There is no central registry.

## Quick start: call a node

```bash
export GITHUB_TOKEN="<github-token>"
creamlon inspect bob/code-review-agent --pretty
creamlon submit bob/code-review-agent \
  --request-id 550e8400-e29b-41d4-a716-446655440000 \
  --capability-id code_review \
  --input "https://github.com/alice/project/pull/42" \
  --requester github:alice/my-agent \
  --payment-key-id customer-1 \
  --keys ./.creamlon/payment.keys.json \
  --payment-expires 2026-06-20T00:00:00Z
```

After delivery:

```bash
creamlon fetch-proof bob/code-review-agent 42 --verify --pretty
```

## Install caller Skill

Copy or symlink this repo's [SKILL.md](SKILL.md) into your agent skills directory.

## Project layout

```
js-creamlon/
├── SKILL.md              # Caller skill
├── bin/creamlon.mjs      # CLI entry
├── cli/                  # Command router
├── lib/                  # proof, payment, acceptance, github, hash
├── references/           # Protocol spec + examples
└── template/agent-node/  # GitHub template source
```

## Documentation

- [Protocol specification](references/protocol.md)
- [Alice/Bob example](references/examples.md)

## Test

```bash
npm test
```

## v0.3.1 scope

- Task-bound, short-lived HMAC payment credentials
- Standard YAML parsing with stable input hashing
- Issue-bound proof verification and trusted comment authors
- Resumable idempotent delivery and local proof audit
- GitHub-native node discovery through the `creamlon-node` Topic
- Ed25519 delivery proofs using protocol version `0.3.1`

## License

MIT
