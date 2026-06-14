# Changelog

## 0.3.0

- Protocol v0.3: token payment verification (`payment.type: token`, `request_id` binding)
- CLI: `creamlon reject`, `fetch-proof`, `token-new`
- Lib: `lib/payment`, `lib/acceptance`, `lib/proofComment`
- `watch` / `deliver` verify payment tokens before acceptance
- Template default: `payment_required: true` with token payment config
- Proof format unchanged (`v: "0.1"`)

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
