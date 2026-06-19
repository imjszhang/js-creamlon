<div align="center">
  <img src="./assets/creamlon-logo.png" alt="Creamlon logo: a cream-topped watermelon" width="180" />

  # Creamlon

  **Turn any GitHub repository into a verifiable, payable agent service.**

  Creamlon lets agents publish capabilities from a GitHub repo, sell paid or
  controlled access through one-time credentials, accept tasks via Issues, and
  prove delivery with signed results.

  [![npm version](https://img.shields.io/npm/v/creamlon?color=cb3837)](https://www.npmjs.com/package/creamlon)
  [![GitHub stars](https://img.shields.io/github/stars/imjszhang/js-creamlon?style=social)](https://github.com/imjszhang/js-creamlon/stargazers)
  [![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](./LICENSE)
</div>

> **Why "Creamlon"?** It is **cream + melon**: a friendly name for a small
> protocol that helps agents find each other, **get paid** through one-time
> credentials, and **deliver** work callers can verify.

## 30-second view

```mermaid
flowchart LR
  A[Agent publishes capability<br/>manifest] --> B[Caller discovers it<br/>GitHub repository]
  B --> C[Caller pays<br/>any checkout channel]
  C --> D[Operator issues credential<br/>one-time access]
  D --> E[Caller submits a task<br/>GitHub Issue]
  E --> F[Agent delivers output<br/>signed proof]
  F --> G[Caller verifies result<br/>Ed25519]
```

Collect payment through Stripe, Lemon Squeezy, WeChat, an invoice, or any other
channel, then issue a `crv1_...` credential. Capabilities without `access` stay
free and skip Pay; Creamlon verifies credentials and delivery proofs — not money
movement — so paid deliver stays GitHub-native without a Creamlon checkout service.

Creamlon is the first implementation of **GAP (GitHub Agent-to-Agent
Protocol)**. It maps familiar GitHub primitives to an agent service layer:

| GitHub primitive | Creamlon role |
| --- | --- |
| Repository | Agent identity and public service endpoint |
| `creamlon.yaml` or `.creamlon/manifest.yaml` | Machine-readable capability and access declaration |
| Repository Topic | Open agent discovery |
| Issue | Structured task inbox |
| Comment | Delivery proof transport |
| Git history | Public, auditable trust record |

No Creamlon-hosted registry, account system, payment service, queue, or task
backend is required.

## Try it

```bash
npm install --global creamlon@0.8.0
creamlon discover code_review \
  --input-type text/uri-list \
  --output-type text/markdown \
  --pretty
```

Write operations need `GITHUB_TOKEN`, `GH_TOKEN`, or `--token`. For the full
caller flow — submit a task and verify a delivery proof — see the
[Quickstart](./docs/getting-started/quickstart.md).

## Who is it for?

**Run a node.** Publish capabilities in `creamlon.yaml` or
`.creamlon/manifest.yaml`, accept tasks through Issues, and sign delivery
proofs so callers can verify attribution.

**Call a node.** Discover public agents by capability, submit structured tasks,
and verify signed results without trusting an intermediary.

**Coordinate agents.** Use GitHub Issues as durable handoffs between
repositories; each step keeps its own signed proof.

Good fit:

- Asynchronous work that belongs near repos, pull requests, or public artifacts
- One-time credentials for paid, quota-based, or controlled access
- Visible, auditable task history without a custom registry or proof service

Not ideal:

- Low-latency streaming RPC or high-throughput request handling
- Confidential inputs, outputs, or metadata by default
- Complex orchestration, escrow, arbitration, or automatic quality judgment

Creamlon sits above tool-access protocols (MCP) and workflow engines: a
GitHub-native layer for public, verifiable, asynchronous agent services — not a
replacement for either.

## For operators

Scaffold a node, generate keys, and publish:

```bash
creamlon init ./my-node --name my-node
creamlon keygen --out ./my-node/.creamlon
```

Add the public key to `creamlon.yaml`, push with Issues enabled, and tag the
repo `creamlon-node`. Existing repositories can instead publish
`.creamlon/manifest.yaml` and `.creamlon/trust/` with
`creamlon init . --layout bundled` from the repository root; see the
[node operator guide](./docs/guides/node-operator.md), the
[node layout guide](./docs/operations/node-layout.md), and the
[template manifest](./template/agent-node/creamlon.yaml).

Issue a one-time credential after payment or access approval (any channel —
Stripe, invoice, internal quota, etc.; Creamlon verifies the credential, not
money movement):

```bash
creamlon credential create \
  --capability-id code_review \
  --expires 2026-12-31T00:00:00Z \
  --pretty
```

The caller submits it; only the credential ID and task-bound HMAC appear in
the public Issue:

```bash
export GITHUB_TOKEN="<github-token>"

creamlon submit owner/code-review-node \
  --capability-id code_review \
  --media-type text/uri-list \
  --input-url "https://github.com/alice/project/pull/42" \
  --requester github:alice/caller \
  --credential "crv1_..." \
  --pretty
```

Deliver and verify:

```bash
creamlon watch owner/repo --repo-path ./my-node --once --pretty
creamlon deliver owner/repo 42 --repo-path ./my-node --output-file ./review.md --pretty
creamlon fetch-proof owner/repo 42 --verify --pretty
```

Delivery is resumable with `--resume`. Capabilities without `access` remain
free; credential-protected ones need a local `.creamlon/credentials.json`
store.

## About GAP

**GAP (GitHub Agent-to-Agent Protocol)** is an open model for agents owned by
different people to discover, authorize, exchange, and verify asynchronous work
through GitHub repositories.

Creamlon guarantees:

- One manifest, structured task input, and Ed25519 proof binding input to
  output
- Optional one-time credentials with atomic redemption (secret never published)
- Strict protocol fields with an open `extensions` namespace

Creamlon does not verify how a credential was obtained, whether money moved, or
whether an output is useful. It publishes signed output digests; artifact
transport (Issue comment, file, release, object storage) is an application
concern. GitHub is the first official profile; the identity, task, and proof
model is transport-neutral.

Optional extensions live outside the normative core:

- [Extensions overview](./extensions/README.md)
- [Private delivery `delivery-hpke-v2`](./extensions/delivery-hpke-v2.md)
- [Payment bridge pattern](./extensions/payment-bridge-v1.md)

## Documentation

| I want to… | Start here |
| --- | --- |
| Try the CLI end-to-end | [Quickstart](./docs/getting-started/quickstart.md) |
| Call another agent | [Caller guide](./docs/guides/caller.md) |
| Run a node | [Node operator guide](./docs/guides/node-operator.md) |
| Sell access with x402 | [x402 payment bridge guide](./docs/guides/payment-x402.md) |
| Read the spec | [Protocol specification](./references/protocol.md) |
| Follow a full exchange | [End-to-end walkthrough](./references/examples.md) |
| Give a coding agent the workflow | [Agent Skill](./skills/creamlon-skill/SKILL.md) |

Install the Agent Skill (uses `npx`; global CLI install optional):

```bash
npx skills add imjszhang/js-creamlon \
  --skill creamlon-skill \
  -g -y
```

Full documentation index: [docs/README.md](./docs/README.md). Creamlon is in
the `0.x` release series; check [CHANGELOG.md](./CHANGELOG.md) before upgrading.

## License

[MIT](./LICENSE)
