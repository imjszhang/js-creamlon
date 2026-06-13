# Changelog

## 0.2.0

- Protocol v0.2: optional `expires`, `input_ref`, `payment` on tasks; `payment_required` / `payment_instructions` on `agent.yaml`
- CLI: `creamlon submit`, `watch`, `deliver` (requires `GITHUB_TOKEN`)
- Lib: `taskYaml`, `dedup`, `github` modules
- Node acceptance: dedup via `proofs.log`, expiry checks
- Templates: v0.2 agent.yaml, Issue template
- Proof format unchanged (`v: "0.1"`)

## 0.1.0

- Initial release: inspect, hash, sign, verify, keygen, init
- Protocol v0.1: agent.yaml, Issues, Ed25519 proofs
