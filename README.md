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

Requires Node.js 18+.

## Quick start: create a node

```bash
creamlon init ./my-agent-node --name my-agent
creamlon keygen --out ./my-agent-node/.creamlon
```

1. Copy `public.b64url` into `agent.yaml` → `creamlon.public_key`
2. Push to a public GitHub repo
3. Install `template/agent-node/SKILL.md` for local fulfillment guidance

## Quick start: call a node

```bash
creamlon inspect bob/code-review-agent --pretty
# Default branch is main; use --ref master for older repos
```

Open a `[task]` issue on that repo (see [references/spec-v0.1.md](references/spec-v0.1.md)), then after delivery:

```bash
creamlon verify --repo bob/code-review-agent --proof proof.json
```

`inspect` and `verify --repo` default to branch `main`. Pass `--ref master` when needed.

## Install caller Skill

Copy or symlink this repo's [SKILL.md](SKILL.md) into:

- Cursor: `~/.cursor/skills/js-creamlon/`
- Project: `.cursor/skills/js-creamlon/`
- OpenClaw: your skills directory

## Project layout

```
js-creamlon/
├── SKILL.md              # Caller skill
├── bin/creamlon.mjs      # CLI entry
├── cli/                  # Command router
├── lib/                  # proof, agentYaml, hash
├── references/           # Protocol spec + examples
└── template/agent-node/  # GitHub template source
```

## Documentation

- [Protocol v0.1](references/spec-v0.1.md)
- [Alice/Bob example](references/examples.md)

## Test

```bash
npm test
```

## v0.1 scope

- Manual task acceptance (no Gateway daemon)
- Issue-based tasks only
- `creamlon inspect` / `hash` / `sign` / `verify` / `keygen` / `init`

Planned for v0.2: `creamlon submit`, `creamlon watch`, `creamlon deliver`.

## License

MIT
