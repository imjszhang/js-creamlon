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
creamlon token-new --out ./my-agent-node/.creamlon/payment.token
```

1. Copy `public.b64url` into `agent.yaml` → `creamlon.public_key`
2. Push to a public GitHub repo
3. Install `template/agent-node/SKILL.md` for local fulfillment guidance

Public nodes should keep `payment_required: true` to limit Issue spam (v0.3 token gate).

## Quick start: call a node

```bash
export GITHUB_TOKEN=ghp_...
creamlon inspect bob/code-review-agent --pretty
creamlon submit bob/code-review-agent \
  --capability-id code_review \
  --input "https://github.com/alice/project/pull/42" \
  --requester github:alice/my-agent \
  --payment-json ./payment.json
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

- [Protocol v0.3](references/spec-v0.3.md)
- [Protocol v0.2](references/spec-v0.2.md)
- [Protocol v0.1](references/spec-v0.1.md) (proof baseline)
- [Alice/Bob example](references/examples.md)

## Test

```bash
npm test
```

## v0.3 scope

- Token payment verification (anti-DDoS gate for public nodes)
- `creamlon reject`, `fetch-proof`, `token-new`
- Unified task acceptance in `watch` / `deliver`
- Proof format unchanged (v0.1 Ed25519)

## License

MIT
