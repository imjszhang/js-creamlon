# Changelog

## 0.3.0 - 2026-06-14

- Added open `extensions` mapping support on version 1 tasks.
- Added `submit --extensions-file` and `submit --extensions-json`.
- Added `delivery-hpke-v1` extension specification and reference implementation
  under `lib/extensions/delivery/`.
- Added `creamlon extension delivery` CLI helpers for prepare, send-input,
  fetch-input, send-output, and fetch-output.
- Added presigned object-storage and GitHub private-repo artifact transports.
- Documented `payment-bridge-v1` as an external payment to credential pattern.
- `inspect` now surfaces `delivery_extension` when advertised in `creamlon.yaml`.

### Fixes

- `hash --file` now hashes raw file bytes, matching extension `send-input` digest checks.
- `extension delivery fetch-input` requires `--output-file`.
- GitHub delivery transport passes `ref`/`branch` on artifact uploads.
- `extension delivery fetch-output` verifies Ed25519 proof signatures by default (`--no-verify` to skip).
- Documented X25519 SPKI/PKCS8 key encoding for delivery keys.

## 0.2.0 - 2026-06-14

- Added optional one-time `voucher-hmac-v1` task credentials without changing
  protocol version `"1"`.
- Added capability access declarations and a machine-readable credential
  profile.
- Added private credential creation, listing, revocation, task authorization,
  atomic redemption, and public redemption logs.
- Extended delivery proofs with optional credential and task-intent digests
  while preserving the canonical payload of existing free-task proofs.
- Added `submit --credential` and `creamlon credential` workflows.

## 0.1.0

- Initial npm and CLI release version `0.1.0`; protocol schema version remains `"1"`.
- Replaced the legacy manifest with one root-level `creamlon.yaml`.
- Added one strict, machine-readable YAML manifest.
- Reduced the core protocol to manifest, task, proof, and identity.
- Added the official GitHub discovery and Issues transport profile.
- Unified task input as `media_type` plus exactly one of `value`, `url`, or `digest`.
- Standardized protocol objects on version `1` and explicit digest/signature names.
- Made HMAC authorization an optional declared profile; free nodes are supported.
- Reserved `extensions` as the open namespace for future integrations.
- Removed compatibility parsing and commands for legacy formats.
- Preserved signed proofs, key rotation continuity, resumable delivery, and local audit.
- Added one installable `creamlon-skill` for caller and node workflows.
- Added automatic synchronization and validation for pinned npm release versions.
