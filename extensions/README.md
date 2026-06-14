# Creamlon Extensions

Creamlon core defines manifest, task, credential, and Ed25519 proof semantics.
Extensions add optional capabilities without changing the proof format or core
validation rules.

## Principles

1. **Core stays small.** Extensions live in this directory, not in
   `references/protocol.md` normative sections.
2. **Proof is not extended.** `output_digest` always binds the plaintext
   artifact. Encryption and transport are extension concerns.
3. **Orthogonal composition.** Payment bridges, private delivery, and future
   integrations can be combined independently.
4. **Discover via manifest.** Nodes advertise supported extension schemes in
   `creamlon.yaml` `extensions`. Tasks may include matching `extensions`
   fields. Core validates only that task `extensions` is a mapping.

## Registered extensions

| Extension | Document | Purpose |
| --- | --- | --- |
| `delivery-hpke-v2` | [delivery-hpke-v2.md](./delivery-hpke-v2.md) | RFC 9180 encrypted bidirectional artifact transport |
| `delivery-hpke-v1` | [delivery-hpke-v1.md](./delivery-hpke-v1.md) | Legacy Creamlon 0.3.0 encrypted transport |
| `payment-bridge-v1` | [payment-bridge-v1.md](./payment-bridge-v1.md) | External payment to credential issuance pattern |

## Interoperability

Each extension defines:

- A stable `scheme` string
- Manifest fields the node publishes
- Task fields the caller includes in the Issue
- Local-only secrets (never in Issues, logs, or commits)
- Verification steps that run after core `fetch-proof --verify`

Reference implementations ship in `lib/extensions/` and thin CLI helpers under
`creamlon extension ...`.
